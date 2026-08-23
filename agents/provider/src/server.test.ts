import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { ToolboxService, encodePayment } from "@slate-base/agent-core";
import {
  TransactionPreflightService,
  type PreflightRpc,
  type PreflightRpcRequest,
} from "./preflight.js";
import { createProviderServer } from "./server.js";

const PAY_TO = "0x2D449c535E4B2e07Bc311fbe1c14bf17fEC16AAb";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function echoToolbox(): ToolboxService {
  return new ToolboxService({
    echo: {
      name: "echo",
      price: () => 1n,
      handle: async (value: unknown) => value,
    },
  });
}

async function withProvider(
  run: (baseUrl: string) => Promise<void>,
  toolbox: ToolboxService = echoToolbox(),
): Promise<void> {
  const app = createProviderServer({
    config: {
      port: 0,
      mockX402: true,
      terms: {
        network: "base-sepolia",
        asset: USDC,
        payTo: PAY_TO,
        rate: "0.0001",
        maxAmount: 1_000_000n,
      },
    },
    toolbox,
  });
  const server = app.listen(0);
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("a channel call requires the secret issued during channel open", async () => {
  await withProvider(async (baseUrl) => {
    const callToken = "channel-access-token-that-is-long-enough";
    const payment = encodePayment({
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
      payload: { authorization: "demo-payment" },
    });
    const opened = await fetch(`${baseUrl}/agent/open`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment": payment },
      body: JSON.stringify({ channelId: "42", escrow: "100", callToken }),
    });
    assert.equal(opened.status, 200);

    const request = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { tool: "echo", args: "hello" } }),
    };
    const rejected = await fetch(`${baseUrl}/channels/42/call`, request);
    assert.equal(rejected.status, 401);

    const served = await fetch(`${baseUrl}/channels/42/call`, {
      ...request,
      headers: { ...request.headers, "x-slate-channel-token": callToken },
    });
    assert.equal(served.status, 200);
    assert.deepEqual(await served.json(), {
      served: true,
      result: { tool: "echo", result: "hello" },
      units: "1",
      cumulativeUnits: "1",
      billable: "100",
    });

    const finalizeRejected = await fetch(`${baseUrl}/channels/42/finalize`, { method: "POST" });
    assert.equal(finalizeRejected.status, 401);

    const finalized = await fetch(`${baseUrl}/channels/42/finalize`, {
      method: "POST",
      headers: { "x-slate-channel-token": callToken },
    });
    assert.equal(finalized.status, 200);
    assert.deepEqual(await finalized.json(), { ok: true, finalUnits: "1" });
  });
});

class ScenarioRpc implements PreflightRpc {
  async call(request: PreflightRpcRequest): Promise<unknown> {
    if (request.to.endsWith("01")) {
      throw Object.assign(new Error("execution reverted: denied"), { name: "ExecutionRevertedError" });
    }
    if (request.to.endsWith("02")) throw new Error("network unavailable");
    return "0x";
  }

  async estimateGas(request: PreflightRpcRequest): Promise<bigint> {
    if (request.to.endsWith("03")) throw new Error("estimation unavailable");
    return 21_000n;
  }
}

function preflightToolbox(): ToolboxService {
  return new ToolboxService({
    preflight_base_transaction: new TransactionPreflightService(() => new ScenarioRpc()),
  });
}

async function openChannel(baseUrl: string, channelId: string, callToken: string): Promise<void> {
  const payment = encodePayment({
    x402Version: 1,
    scheme: "exact",
    network: "base-sepolia",
    payload: { authorization: "demo-payment" },
  });
  const response = await fetch(`${baseUrl}/agent/open`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment": payment },
    body: JSON.stringify({ channelId, escrow: "1000", callToken }),
  });
  assert.equal(response.status, 200);
}

async function callPreflight(
  baseUrl: string,
  channelId: string,
  callToken: string,
  args: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/channels/${channelId}/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slate-channel-token": callToken,
    },
    body: JSON.stringify({ payload: { tool: "preflight_base_transaction", args } }),
  });
}

const FROM = "0x00000000000000000000000000000000000000aa";
const BASE_PREFLIGHT = { chainId: 84532, from: FROM, data: "0x" };

test("preflight results are served and meter two units per result", async () => {
  await withProvider(async (baseUrl) => {
    const scenarios = [
      {
        to: "0x0000000000000000000000000000000000000001",
        simulationStatus: "revert",
        verdict: "block",
      },
      {
        to: "0x0000000000000000000000000000000000000002",
        simulationStatus: "error",
        verdict: "caution",
      },
      {
        to: "0x0000000000000000000000000000000000000003",
        simulationStatus: "success",
        verdict: "caution",
      },
    ] as const;

    for (const [index, scenario] of scenarios.entries()) {
      const channelId = String(index + 100);
      const callToken = `preflight-channel-token-${index}-long-enough`;
      await openChannel(baseUrl, channelId, callToken);

      const response = await callPreflight(baseUrl, channelId, callToken, {
        ...BASE_PREFLIGHT,
        to: scenario.to,
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        served: boolean;
        units: string;
        cumulativeUnits: string;
        result: { result: { simulationStatus: string; verdict: string } };
      };
      assert.equal(body.served, true);
      assert.equal(body.units, "2");
      assert.equal(body.cumulativeUnits, "2");
      assert.equal(body.result.result.simulationStatus, scenario.simulationStatus);
      assert.equal(body.result.result.verdict, scenario.verdict);
    }
  }, preflightToolbox());
});

test("preflight validation failures do not advance the meter", async () => {
  await withProvider(async (baseUrl) => {
    const channelId = "200";
    const callToken = "preflight-validation-token-that-is-long-enough";
    await openChannel(baseUrl, channelId, callToken);

    const response = await callPreflight(baseUrl, channelId, callToken, {
      ...BASE_PREFLIGHT,
      chainId: 1,
      to: "0x0000000000000000000000000000000000000004",
    });
    assert.equal(response.status, 502);

    const finalized = await fetch(`${baseUrl}/channels/${channelId}/finalize`, {
      method: "POST",
      headers: { "x-slate-channel-token": callToken },
    });
    assert.deepEqual(await finalized.json(), { ok: true, finalUnits: "0" });
  }, preflightToolbox());
});
