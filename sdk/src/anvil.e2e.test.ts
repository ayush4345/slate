import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, type Address } from "viem";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import { erc20Abi, escrowAbi } from "./abi.js";
import { accountFromPrivateKey, SlateClient } from "./client.js";
import { ensureProvingArtifacts, proveSettlement } from "./prove.js";
import {
  escrowGetBalance,
  escrowGetRegistry,
  escrowGetVerifier,
  registryGetChannel,
  registryHasChannel,
  verifierVerify,
} from "./reads.js";
import { toPublicSignals, type ProofCalldata, type Settlement } from "./settlement.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Anvil account 0 — the DeployLocal broadcaster and the depositor. */
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/** Anvil account 1 — the provider. */
const PROVIDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

const ESCROW_AMOUNT = 1_000_000n;
const RATE = 4n;
const RATE_BLIND = 99n;
const TOTAL_UNITS = 250n;
const CHANNEL_SECRET = 0x5ec2edn;
const CONSUMER_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

const mockUsdcAbi = parseAbi([
  "function mint(address to, uint256 amount)",
]);

interface Deployed {
  token: Address;
  verifier: Address;
  registry: Address;
  escrow: Address;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("could not bind an ephemeral port"));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForRpc(url: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil did not become ready at ${url}`);
}

function startAnvil(port: number): ChildProcess {
  return spawn("anvil", ["--host", "127.0.0.1", "--port", String(port)], {
    stdio: "ignore",
  });
}

async function deploy(rpcUrl: string): Promise<Deployed> {
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    "forge",
    [
      "script",
      "script/DeployLocal.s.sol:DeployLocal",
      "--rpc-url",
      rpcUrl,
      "--broadcast",
      "--private-key",
      DEPLOYER_KEY,
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );

  const run = JSON.parse(
    readFileSync(`${repoRoot}/broadcast/DeployLocal.s.sol/31337/run-latest.json`, "utf8"),
  ) as {
    transactions: Array<{ contractName?: string; contractAddress?: string }>;
  };

  const addressOf = (name: string): Address => {
    const tx = run.transactions.find((t) => t.contractName === name);
    if (!tx?.contractAddress) throw new Error(`broadcast JSON missing ${name}`);
    return tx.contractAddress as Address;
  };

  return {
    token: addressOf("MockUSDC"),
    verifier: addressOf("Groth16Verifier"),
    registry: addressOf("SlateAgentRegistry"),
    escrow: addressOf("SlateEscrow"),
  };
}

async function deployWithGeneratedVerifier(rpcUrl: string): Promise<Deployed> {
  const { execFileSync } = await import("node:child_process");
  const artifacts = ensureProvingArtifacts();

  const create = (artifact: string, args: string[] = []): Address => {
    const out = execFileSync(
      "forge",
      [
        "create",
        artifact,
        "--rpc-url",
        rpcUrl,
        "--private-key",
        DEPLOYER_KEY,
        "--broadcast",
        ...(args.length > 0 ? ["--constructor-args", ...args] : []),
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const match = out.match(/Deployed to: (0x[0-9a-fA-F]{40})/);
    if (!match) throw new Error(`forge create ${artifact} produced no address:\n${out}`);
    return match[1] as Address;
  };

  const verifier = create(artifacts.verifierSol + ":Groth16Verifier");
  const registry = create("src/SlateAgentRegistry.sol:SlateAgentRegistry");
  const owner = privateKeyToAccount(DEPLOYER_KEY).address;
  const escrow = create("src/SlateEscrow.sol:SlateEscrow", [verifier, registry, owner]);
  const token = create("script/DeployLocal.s.sol:MockUSDC");

  const wallet = createWalletClient({
    account: privateKeyToAccount(DEPLOYER_KEY),
    chain: foundry,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl) });

  const mintHash = await wallet.writeContract({
    address: token,
    abi: mockUsdcAbi,
    functionName: "mint",
    args: [owner, 1_000_000n * 1_000_000n],
    chain: foundry,
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });

  const whitelistHash = await wallet.writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "whitelistToken",
    args: [token],
    chain: foundry,
  });
  await publicClient.waitForTransactionReceipt({ hash: whitelistHash });

  return { token, verifier, registry, escrow };
}

/** A well-formed but meaningless proof — the generated verifier must reject it. */
function dummySettlement(channelId: bigint): Settlement {
  const proof: ProofCalldata = {
    a: [1n, 2n],
    b: [
      [1n, 2n],
      [1n, 2n],
    ],
    c: [1n, 2n],
  };
  return { proof, publicSignals: toPublicSignals(Array.from({ length: 13 }, (_, i) => (i === 0 ? channelId : 0n))) };
}

test("anvil: deploy, open a channel, and exercise the read path", { timeout: 120_000 }, async () => {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = startAnvil(port);

  try {
    await waitForRpc(rpcUrl);
    const deployed = await deploy(rpcUrl);

    const account = accountFromPrivateKey(DEPLOYER_KEY);
    const client = new SlateClient({
      rpcUrl,
      chain: foundry,
      account,
      contracts: { escrow: deployed.escrow, registry: deployed.registry },
    });

    const channelId = 42n;
    const opened = await client.openChannel({
      channelId,
      rateCommitment: 0xc0ffeen,
      consumerPublicKey: { x: 111n, y: 222n },
      provider: PROVIDER,
      token: deployed.token,
      escrow: ESCROW_AMOUNT,
    });
    assert.equal(opened.channelId, "42");
    assert.ok(opened.transactions.length >= 2, "register + deposit, plus approve if needed");
    for (const hash of opened.transactions) {
      assert.match(hash, /^0x[0-9a-fA-F]{64}$/);
    }

    const reads = {
      publicClient: createPublicClient({ chain: foundry, transport: http(rpcUrl) }),
      escrow: deployed.escrow,
      registry: deployed.registry,
    };

    assert.equal(await registryHasChannel(reads, channelId), true);
    assert.equal(await registryHasChannel(reads, channelId + 1n), false);

    const channel = await registryGetChannel(reads, channelId);
    assert.equal(channel.depositor.toLowerCase(), account.address.toLowerCase());
    assert.equal(channel.provider.toLowerCase(), PROVIDER.toLowerCase());
    assert.equal(channel.token.toLowerCase(), deployed.token.toLowerCase());
    assert.equal(channel.rateCommitment, 0xc0ffeen);
    assert.equal(channel.consumerPubkeyX, 111n);
    assert.equal(channel.consumerPubkeyY, 222n);
    assert.equal(channel.open, true);
    assert.equal(channel.exists, true);

    assert.equal(await escrowGetBalance(reads, account.address, deployed.token), ESCROW_AMOUNT);
    assert.equal((await escrowGetVerifier(reads)).toLowerCase(), deployed.verifier.toLowerCase());
    assert.equal((await escrowGetRegistry(reads)).toLowerCase(), deployed.registry.toLowerCase());

    const accepted = await verifierVerify(reads, dummySettlement(channelId));
    assert.equal(accepted, false);
  } finally {
    anvil.kill("SIGTERM");
  }
});

test("anvil: open, meter, prove, and settle", { timeout: 600_000 }, async () => {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = startAnvil(port);

  try {
    await waitForRpc(rpcUrl);
    const artifacts = ensureProvingArtifacts();
    const deployed = await deployWithGeneratedVerifier(rpcUrl);

    const account = accountFromPrivateKey(DEPLOYER_KEY);
    const client = new SlateClient({
      rpcUrl,
      chain: foundry,
      account,
      contracts: { escrow: deployed.escrow, registry: deployed.registry },
    });

    const channelId = 7n;
    const proveArgs = {
      channelId,
      channelSecret: CHANNEL_SECRET,
      rate: RATE,
      rateBlind: RATE_BLIND,
      totalUnits: TOTAL_UNITS,
      escrowAmount: ESCROW_AMOUNT,
      depositor: account.address,
      provider: PROVIDER,
      token: deployed.token,
      consumerPrivateKey: CONSUMER_KEY,
      artifacts,
    };

    const { terms } = await proveSettlement(proveArgs);
    assert.equal(terms.settlementAmount, TOTAL_UNITS * RATE);

    await client.openChannel({
      channelId,
      rateCommitment: terms.rateCommitment,
      consumerPublicKey: terms.consumerPublicKey,
      provider: PROVIDER,
      token: deployed.token,
      escrow: ESCROW_AMOUNT,
    });

    const { settlement } = await proveSettlement(proveArgs);

    const reads = {
      publicClient: createPublicClient({ chain: foundry, transport: http(rpcUrl) }),
      escrow: deployed.escrow,
      registry: deployed.registry,
    };

    assert.equal(await verifierVerify(reads, settlement), true);

    const settleTx = await client.settle(settlement);
    assert.match(settleTx, /^0x[0-9a-fA-F]{64}$/);

    assert.equal(await escrowGetBalance(reads, account.address, deployed.token), 0n);
    const tokenBalance = async (who: Address) =>
      reads.publicClient.readContract({
        address: deployed.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [who],
      });

    assert.equal(await tokenBalance(PROVIDER), terms.settlementAmount);
    assert.equal(
      await tokenBalance(account.address),
      1_000_000n * 1_000_000n - terms.settlementAmount,
    );
  } finally {
    anvil.kill("SIGTERM");
  }
});

// circomlibjs / snarkjs WASM keeps the event loop alive after a real prove.
after(() => {
  setImmediate(() => process.exit(process.exitCode ?? 0));
});
