import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TransactionPreflightService,
  type PreflightRpc,
  type PreflightRpcRequest,
} from "./preflight.js";

const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const SPENDER = "0x3333333333333333333333333333333333333333";
const OWNER = "0x4444444444444444444444444444444444444444";
const RECIPIENT = "0x5555555555555555555555555555555555555555";
const MAX_UINT256 = (2n ** 256n - 1n).toString(16).padStart(64, "0");

function wordAddress(address: string): string {
  return address.slice(2).padStart(64, "0");
}

function calldata(selector: string, ...words: string[]): `0x${string}` {
  return `0x${selector}${words.join("")}`;
}

class CannedRpc implements PreflightRpc {
  readonly calls: PreflightRpcRequest[] = [];
  readonly estimates: PreflightRpcRequest[] = [];

  constructor(
    private readonly callResult: () => Promise<unknown> = async () => "0x",
    private readonly estimateResult: () => Promise<bigint> = async () => 21_000n,
  ) {}

  async call(request: PreflightRpcRequest): Promise<unknown> {
    this.calls.push(request);
    return this.callResult();
  }

  async estimateGas(request: PreflightRpcRequest): Promise<bigint> {
    this.estimates.push(request);
    return this.estimateResult();
  }
}

function serviceFor(rpc: PreflightRpc, seen: number[] = []): TransactionPreflightService {
  return new TransactionPreflightService((chainId: number) => {
    seen.push(chainId);
    return rpc;
  });
}

test("preflight simulates a valid pending transaction and returns a safe gas estimate", async () => {
  const rpc = new CannedRpc();
  const service = serviceFor(rpc);

  assert.equal(service.price({ chainId: 84532, from: FROM, to: TO }), 2n);
  const result = await service.handle({ chainId: 84532, from: FROM, to: TO, data: "0x", value: "0" });

  assert.deepEqual(result, {
    simulationStatus: "success",
    gasEstimate: "21000",
    verdict: "safe",
    evidence: [
      { kind: "simulation", severity: "info", message: "Pending-state simulation succeeded." },
      { kind: "gas", severity: "info", message: "Estimated gas: 21000." },
      { kind: "calldata", severity: "info", message: "No calldata supplied." },
      { kind: "simulation", severity: "info", message: "Safe means non-reverting simulation, not an execution or security guarantee." },
    ],
  });
  assert.deepEqual(rpc.calls[0], { account: FROM, to: TO, data: "0x", value: 0n, blockTag: "pending" });
  assert.deepEqual(rpc.estimates[0], { account: FROM, to: TO, data: "0x", value: 0n, blockTag: "pending" });
});

test("preflight blocks a deterministic simulation revert", async () => {
  const service = serviceFor(new CannedRpc(async () => {
    throw Object.assign(new Error("execution reverted: insufficient balance at https://api-key@rpc.example.test"), {
      name: "ExecutionRevertedError",
    });
  }));

  const result = await service.handle({ chainId: 84532, from: FROM, to: TO });

  assert.equal(result.simulationStatus, "revert");
  assert.equal(result.verdict, "block");
  assert.equal(result.evidence[0]?.kind, "simulation");
  assert.equal(result.evidence[0]?.severity, "error");
  assert.equal(result.evidence[0]?.message, "Simulation reverted.");
  assert.equal(result.evidence[0]?.message.includes("api-key"), false);
});

test("preflight treats arbitrary errors mentioning reverts as transport failures", async () => {
  const service = serviceFor(new CannedRpc(async () => {
    throw new Error("proxy error: execution reverted while https://api-key@rpc.example.test was unavailable");
  }));

  const result = await service.handle({ chainId: 84532, from: FROM, to: TO });

  assert.equal(result.simulationStatus, "error");
  assert.equal(result.verdict, "caution");
  assert.equal(
    result.evidence[0]?.message,
    "Simulation RPC failed.",
  );
  assert.equal(result.evidence[0]?.message.includes("api-key"), false);
});

test("preflight treats transport call failures as caution", async () => {
  const service = serviceFor(new CannedRpc(async () => {
    throw new Error("RPC connection to https://api-key@rpc.example.test timed out");
  }));

  const result = await service.handle({ chainId: 84532, from: FROM, to: TO });

  assert.equal(result.simulationStatus, "error");
  assert.equal(result.verdict, "caution");
  assert.equal(result.evidence[0]?.message, "Simulation RPC failed.");
  assert.equal(result.evidence[0]?.message.includes("api-key"), false);
});

test("preflight treats gas estimation failures after simulation as caution", async () => {
  const service = serviceFor(new CannedRpc(
    async () => "0x",
    async () => { throw new Error("rate limited by https://api-key@rpc.example.test"); },
  ));

  const result = await service.handle({ chainId: 84532, from: FROM, to: TO });

  assert.equal(result.simulationStatus, "success");
  assert.equal(result.verdict, "caution");
  assert.deepEqual(result.evidence.slice(0, 2), [
    { kind: "simulation", severity: "info", message: "Pending-state simulation succeeded." },
    { kind: "gas", severity: "warn", message: "Gas estimation failed." },
  ]);
  assert.equal(result.evidence[1]?.message.includes("api-key"), false);
});

test("preflight decodes unlimited ERC-20 approvals and warns", async () => {
  const service = serviceFor(new CannedRpc());
  const data = calldata("095ea7b3", wordAddress(SPENDER), MAX_UINT256);

  const result = await service.handle({ chainId: 8453, from: FROM, to: TO, data });

  assert.deepEqual(result.decoded, {
    kind: "approve", token: TO, owner: FROM, spender: SPENDER,
    amount: (2n ** 256n - 1n).toString(), unlimited: true,
  });
  assert.equal(result.verdict, "caution");
  assert.ok(result.evidence.some((item: { kind: string; severity: string }) => item.kind === "approval" && item.severity === "warn"));
});

test("preflight decodes direct ERC-20 transfers", async () => {
  const service = serviceFor(new CannedRpc());
  const data = calldata("a9059cbb", wordAddress(RECIPIENT), (42n).toString(16).padStart(64, "0"));

  const result = await service.handle({ chainId: 84532, from: FROM, to: TO, data });

  assert.deepEqual(result.decoded, {
    kind: "transfer", token: TO, from: FROM, to: RECIPIENT, amount: "42",
  });
  assert.equal(result.verdict, "safe");
});

test("preflight decodes direct ERC-20 transferFrom calls", async () => {
  const service = serviceFor(new CannedRpc());
  const data = calldata(
    "23b872dd", wordAddress(OWNER), wordAddress(RECIPIENT), (99n).toString(16).padStart(64, "0"),
  );

  const result = await service.handle({ chainId: 84532, from: FROM, to: TO, data });

  assert.deepEqual(result.decoded, {
    kind: "transferFrom", token: TO, owner: OWNER, spender: FROM, to: RECIPIENT, amount: "99",
  });
  assert.equal(result.verdict, "safe");
});

test("preflight warns for unknown direct calldata", async () => {
  const service = serviceFor(new CannedRpc());

  const result = await service.handle({ chainId: 84532, from: FROM, to: TO, data: "0xdeadbeef" });

  assert.equal(result.decoded, undefined);
  assert.equal(result.verdict, "caution");
  assert.ok(result.evidence.some((item: { kind: string; severity: string }) => item.kind === "calldata" && item.severity === "warn"));
});

test("preflight rejects invalid requests before creating an RPC client", async () => {
  const seen: number[] = [];
  const service = serviceFor(new CannedRpc(), seen);
  const invalid = [
    { chainId: 84532, from: "0x1234", to: TO },
    { chainId: 84532, from: FROM, to: "not-an-address" },
    { chainId: 84532, from: FROM, to: TO, data: "not-hex" },
    { chainId: 84532, from: FROM, to: TO, data: "0x0" },
    { chainId: 84532, from: FROM, to: TO, value: "-1" },
    { chainId: 84532, from: FROM, to: TO, value: "1.5" },
    { chainId: 1, from: FROM, to: TO },
  ];

  for (const request of invalid) {
    await assert.rejects(() => service.handle(request), /invalid|unsupported/i);
  }
  assert.deepEqual(seen, []);
});

test("preflight obtains the RPC client for the requested chain", async () => {
  const mainnet = new CannedRpc();
  const sepolia = new CannedRpc();
  const seen: number[] = [];
  const service = new TransactionPreflightService((chainId: number) => {
    seen.push(chainId);
    return chainId === 8453 ? mainnet : sepolia;
  });

  await service.handle({ chainId: 8453, from: FROM, to: TO });

  assert.deepEqual(seen, [8453]);
  assert.equal(mainnet.calls.length, 1);
  assert.equal(sepolia.calls.length, 0);
});
