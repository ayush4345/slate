import { getAddress, type Address, type Chain } from "viem";
import { baseSepolia } from "viem/chains";

import { accountFromPrivateKey, CHAINS, SlateClient, SlateClientError } from "./client.js";

/** A configured client plus the addresses it binds into every proof. */
export interface SlateEnvSetup {
  client: SlateClient;
  /** Depositor — the signing account. Also what the proof must bind. */
  depositor: Address;
  /** Payout address the escrow sends the provider's share to. */
  provider: Address;
  /** ERC-20 settled in. Must be whitelisted on the escrow. */
  token: Address;
  chain: Chain;
  /** Human-readable summary of the bound addresses, for logging. */
  label: string;
}

/** Chains settlement can run against, keyed by id. Follows `CHAINS`, so a chain
 *  added there is selectable here without a second edit. */
const CHAINS_BY_ID = new Map<number, Chain>(
  Object.values(CHAINS).map((chain) => [chain.id, chain]),
);

/** Anvil advertises no public RPC of its own. */
const DEFAULT_RPC_URLS: Record<number, string> = {
  31337: "http://127.0.0.1:8545",
};

/** Circle USDC. Mirrors the constants in `script/Deploy.s.sol`. */
export const USDC = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const satisfies Record<number, Address>;

/**
 * USDC for a chain, where there is one. Anvil's token is deployed per-run, so
 * local runs have to name it.
 */
export function defaultToken(chainId: number): Address | undefined {
  return USDC[chainId as keyof typeof USDC];
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new SlateClientError(`${name} is required once EVM_PRIVATE_KEY is set`);
  return value;
}

function parseAddress(raw: string, name: string): Address {
  try {
    return getAddress(raw);
  } catch {
    throw new SlateClientError(`${name} must be a 20-byte address, received "${raw}"`);
  }
}

function address(env: NodeJS.ProcessEnv, name: string): Address {
  return parseAddress(required(env, name), name);
}

/**
 * Build a configured {@link SlateClient} from the environment, or return `null`
 * when `EVM_PRIVATE_KEY` is unset so callers fall back to a mock.
 *
 * Setting the key is the "go real" signal; the deployed addresses then become
 * required, and an absent one throws here rather than surfacing as an
 * unexplained revert later.
 *
 * Env:
 *  - `EVM_PRIVATE_KEY`          32-byte hex key that funds escrow and signs.
 *  - `SLATE_ESCROW_ADDRESS`, `SLATE_REGISTRY_ADDRESS`   deployed contracts.
 *  - `SETTLEMENT_TOKEN`         ERC-20 to settle in (whitelisted on the escrow).
 *                               Defaults to USDC on Base and Base Sepolia.
 *  - `PROVIDER_ADDRESS`         payout address; defaults to the depositor.
 *  - `BASE_CHAIN_ID`            8453, 84532 (default), or 31337 for anvil.
 *  - `BASE_RPC_URL`             defaults to the chain's public RPC.
 */
export function slateClientFromEnv(env: NodeJS.ProcessEnv = process.env): SlateEnvSetup | null {
  const privateKey = env.EVM_PRIVATE_KEY;
  if (!privateKey) return null;

  const chainId = env.BASE_CHAIN_ID ? Number(env.BASE_CHAIN_ID) : baseSepolia.id;
  const chain = CHAINS_BY_ID.get(chainId);
  if (!chain) {
    throw new SlateClientError(
      `BASE_CHAIN_ID ${env.BASE_CHAIN_ID} is not a supported chain (` +
        `${[...CHAINS_BY_ID.keys()].join(", ")})`,
    );
  }

  const rpcUrl =
    env.BASE_RPC_URL ?? DEFAULT_RPC_URLS[chain.id] ?? chain.rpcUrls.default.http[0];
  if (!rpcUrl) throw new SlateClientError(`BASE_RPC_URL is required for chain ${chain.id}`);

  const account = accountFromPrivateKey(privateKey);
  const depositor = account.address;
  const provider = env.PROVIDER_ADDRESS ? address(env, "PROVIDER_ADDRESS") : depositor;
  const token = env.SETTLEMENT_TOKEN
    ? address(env, "SETTLEMENT_TOKEN")
    : defaultToken(chain.id);
  if (!token) {
    throw new SlateClientError(`SETTLEMENT_TOKEN is required on chain ${chain.id}: no USDC default`);
  }

  const client = new SlateClient({
    rpcUrl,
    chain,
    account,
    contracts: {
      escrow: address(env, "SLATE_ESCROW_ADDRESS"),
      registry: address(env, "SLATE_REGISTRY_ADDRESS"),
    },
  });

  return {
    client,
    depositor,
    provider,
    token,
    chain,
    label:
      `chain=${chain.name} depositor=${depositor.slice(0, 8)}… ` +
      `provider=${provider.slice(0, 8)}… token=${token.slice(0, 8)}…`,
  };
}
