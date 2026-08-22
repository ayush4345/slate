import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import {
  erc20Abi,
  escrowAbi,
  registryAbi,
  type ContractAddresses,
} from "@slate-base/onchain-setup";
import { addressToFieldPair, SIGNAL, type Settlement } from "@slate-base/proving-setup";

export interface SlateClientOptions {
  rpcUrl: string;
  contracts: ContractAddresses;
  /** Funds the escrow and signs every transaction. */
  account: Account;
  /** Defaults to Base Sepolia. */
  chain?: Chain;
}

export interface OpenChannelArgs {
  channelId: bigint;
  rateCommitment: bigint;
  consumerPublicKey: { x: bigint; y: bigint };
  provider: Address;
  token: Address;
  /** Amount to lock, in the token's base units. */
  escrow: bigint;
}

export interface OpenChannelResult {
  channelId: string;
  /** Hashes of the transactions sent, in order. Approve is absent when the
   *  existing allowance already covered the deposit. */
  transactions: Hex[];
}

export class SlateClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlateClientError";
  }
}

/**
 * Drives the settlement contracts on Base.
 *
 * Opening a channel is three transactions — approve, register, deposit. The
 * escrow pulls the deposit, so an allowance has to exist first, and the
 * registry has to hold the channel's terms before any proof can be checked
 * against them. Closing it is one transaction carrying the proof.
 */
export class SlateClient {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly contracts: ContractAddresses;
  readonly chain: Chain;
  private readonly account: Account;

  constructor(options: SlateClientOptions) {
    this.chain = options.chain ?? baseSepolia;
    this.contracts = options.contracts;
    this.account = options.account;

    const transport = http(options.rpcUrl);
    this.publicClient = createPublicClient({ chain: this.chain, transport });
    this.walletClient = createWalletClient({
      account: options.account,
      chain: this.chain,
      transport,
    });
  }

  get address(): Address {
    return this.account.address;
  }

  /**
   * Lock escrow and pin the channel's terms.
   *
   * The depositor is always the signing account: the escrow credits
   * `msg.sender` and the registry records it, so there is no way to open a
   * channel on someone else's behalf.
   */
  async openChannel(args: OpenChannelArgs): Promise<OpenChannelResult> {
    if (args.escrow <= 0n) {
      throw new SlateClientError(`escrow must be positive, received ${args.escrow}`);
    }
    await this.assertWhitelisted(args.token);

    const transactions: Hex[] = [];

    const approve = await this.ensureAllowance(args.token, args.escrow);
    if (approve) transactions.push(approve);

    transactions.push(
      await this.send(this.contracts.registry, registryAbi, "registerChannel", [
        args.channelId,
        args.rateCommitment,
        args.consumerPublicKey.x,
        args.consumerPublicKey.y,
        args.provider,
        args.token,
      ]),
    );

    transactions.push(
      await this.send(this.contracts.escrow, escrowAbi, "deposit", [args.token, args.escrow]),
    );

    return { channelId: args.channelId.toString(), transactions };
  }

  /**
   * Close a channel against a proof: the provider is paid what is owed and the
   * remainder returns to the depositor.
   *
   * Takes no addresses. The escrow reads the parties from the registry rather
   * than from whoever submits, so there is nothing here for a caller to
   * redirect — which is also why anyone may send this transaction.
   */
  async settle(settlement: Settlement): Promise<Hex> {
    const { proof, publicSignals } = settlement;
    return this.send(this.contracts.escrow, escrowAbi, "settle", [
      proof.a,
      proof.b,
      proof.c,
      publicSignals,
    ]);
  }

  /**
   * Check the signals a proof carries against what the chain and this client
   * believe, before spending gas discovering it on-chain.
   *
   * A settlement that fails here would revert; the point is to say which of the
   * thirteen signals disagrees, rather than surfacing a bare `DepositorMismatch`
   * from inside the registry.
   */
  async explainSettlement(settlement: Settlement): Promise<string[]> {
    const signals = settlement.publicSignals;
    const problems: string[] = [];

    const channelId = signals[SIGNAL.channelId]!;
    const registered = await this.publicClient.readContract({
      address: this.contracts.registry,
      abi: registryAbi,
      functionName: "hasChannel",
      args: [channelId],
    });
    if (!registered) problems.push(`channel ${channelId} is not registered`);

    const escrowAmount = signals[SIGNAL.escrowAmount]!;
    const settlementAmount = signals[SIGNAL.settlementAmount]!;
    if (settlementAmount > escrowAmount) {
      problems.push(`settlement ${settlementAmount} exceeds escrow ${escrowAmount}`);
    }

    const [depositorHi, depositorLo] = addressToFieldPair(this.account.address);
    if (signals[SIGNAL.depositorHi] !== depositorHi || signals[SIGNAL.depositorLo] !== depositorLo) {
      problems.push(`proof binds a different depositor than ${this.account.address}`);
    }

    return problems;
  }

  /** Escrow still locked for `token`, in base units. */
  async escrowBalance(token: Address, depositor?: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.contracts.escrow,
      abi: escrowAbi,
      functionName: "balanceOf",
      args: [depositor ?? this.account.address, token],
    });
  }

  /** Withdraw everything not yet settled for `token`. */
  async refund(token: Address): Promise<Hex> {
    return this.send(this.contracts.escrow, escrowAbi, "refund", [token]);
  }

  /** Stop further settlement on a channel. Either party may call it. */
  async closeChannel(channelId: bigint): Promise<Hex> {
    return this.send(this.contracts.registry, registryAbi, "closeChannel", [channelId]);
  }

  private async assertWhitelisted(token: Address): Promise<void> {
    const ok = await this.publicClient.readContract({
      address: this.contracts.escrow,
      abi: escrowAbi,
      functionName: "whitelisted",
      args: [token],
    });
    if (!ok) {
      throw new SlateClientError(`token ${token} is not whitelisted on the escrow`);
    }
  }

  /** Approve only when the standing allowance falls short. */
  private async ensureAllowance(token: Address, amount: bigint): Promise<Hex | null> {
    const allowance = await this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [this.account.address, this.contracts.escrow],
    });
    if (allowance >= amount) return null;
    return this.send(token, erc20Abi, "approve", [this.contracts.escrow, amount]);
  }

  /**
   * Simulate, send, wait. Simulating first turns a revert into a decoded custom
   * error before it costs gas, instead of a failed receipt to reverse-engineer
   * afterwards.
   */
  private async send(
    address: Address,
    abi: unknown,
    functionName: string,
    args: readonly unknown[],
  ): Promise<Hex> {
    const { request } = await this.publicClient.simulateContract({
      address,
      abi: abi as never,
      functionName,
      args: args as never,
      account: this.account,
    });

    const hash = await this.walletClient.writeContract(request as never);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new SlateClientError(`${functionName} reverted (tx ${hash})`);
    }
    return hash;
  }
}

/** Build a signing account from a `0x…` private key. */
export function accountFromPrivateKey(privateKey: string): Account {
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new SlateClientError("private key must be 32 bytes of hex");
  }
  return privateKeyToAccount(key as Hex);
}
