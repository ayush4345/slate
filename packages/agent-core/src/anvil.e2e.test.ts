import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type Address } from "viem";
import { foundry } from "viem/chains";

import { accountFromPrivateKey, SlateClient } from "./client.js";
import {
  escrowGetBalance,
  escrowGetRegistry,
  escrowGetVerifier,
  registryGetChannel,
  registryHasChannel,
  verifierVerify,
} from "./reads.js";
import {
  toPublicSignals,
  type ProofCalldata,
  type Settlement,
} from "@slate-base/proving-setup";

/** The Foundry project, resolved from `dist/`. */
const forgeRoot = fileURLToPath(new URL("../../onchain-setup/evm/", import.meta.url));

/** Anvil account 0 — the DeployLocal broadcaster and the depositor. */
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/** Anvil account 1 — the provider. */
const PROVIDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

const ESCROW_AMOUNT = 1_000_000n;

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
  const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.unref();
  return child;
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
    { cwd: forgeRoot, stdio: "pipe" },
  );

  const run = JSON.parse(
    readFileSync(`${forgeRoot}broadcast/DeployLocal.s.sol/31337/run-latest.json`, "utf8"),
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
