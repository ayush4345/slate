import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { ToolboxService, encodePayment } from "@slate-base/agent-core";
import { createProviderServer } from "./server.js";

const PAY_TO = "0x2D449c535E4B2e07Bc311fbe1c14bf17fEC16AAb";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function withProvider(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const toolbox = new ToolboxService({
    echo: {
      name: "echo",
      price: () => 1n,
      handle: async (value: unknown) => value,
    },
  });
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
