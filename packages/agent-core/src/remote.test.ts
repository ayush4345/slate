import assert from "node:assert/strict";
import { test } from "node:test";

import { RemoteChannel } from "./remote.js";

test("RemoteChannel uses explicit served response units for the call cost", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/agent/open")) {
      return new Response(
        JSON.stringify({
          accepts: [
            {
              rate: "0.0001",
              payTo: "0x0000000000000000000000000000000000000001",
              asset: "0x0000000000000000000000000000000000000002",
              network: "base-sepolia",
            },
          ],
          ok: true,
        }),
        { status: init?.headers && "X-PAYMENT" in init.headers ? 200 : 402 },
      );
    }
    return new Response(
      JSON.stringify({
        served: true,
        units: "2",
        cumulativeUnits: "2",
        billable: "200",
        result: { tool: "preflight_base_transaction", result: { verdict: "safe" } },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const channel = await RemoteChannel.open({
      providerUrl: "https://provider.example.test",
      channelId: 42n,
      escrow: 1_000n,
      callToken: "channel-call-token",
      payment: "payment-proof",
    });
    const outcome = await channel.call({
      tool: "preflight_base_transaction",
      args: {
        chainId: 84532,
        from: "0x00000000000000000000000000000000000000aa",
        to: "0x00000000000000000000000000000000000000bb",
      },
    });

    assert.equal(outcome.served, true);
    assert.equal(outcome.cost, 2n);
    assert.equal(outcome.cumulativeUnits, 2n);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RemoteChannel derives served call cost from old provider cumulative units", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/agent/open")) {
      return new Response(
        JSON.stringify({
          accepts: [
            {
              rate: "0.0001",
              payTo: "0x0000000000000000000000000000000000000001",
              asset: "0x0000000000000000000000000000000000000002",
              network: "base-sepolia",
            },
          ],
          ok: true,
        }),
        { status: init?.headers && "X-PAYMENT" in init.headers ? 200 : 402 },
      );
    }
    calls++;
    return new Response(
      JSON.stringify({
        served: true,
        cumulativeUnits: calls === 1 ? "2" : "5",
        result: { tool: "preflight_base_transaction", result: { verdict: "safe" } },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const channel = await RemoteChannel.open({
      providerUrl: "https://provider.example.test",
      channelId: 42n,
      escrow: 1_000n,
      callToken: "channel-call-token",
      payment: "payment-proof",
    });
    const request = {
      tool: "preflight_base_transaction",
      args: {
        chainId: 84532,
        from: "0x00000000000000000000000000000000000000aa",
        to: "0x00000000000000000000000000000000000000bb",
      },
    };

    assert.equal((await channel.call(request)).cost, 2n);
    assert.equal((await channel.call(request)).cost, 3n);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RemoteChannel defaults served old-provider call cost to one unit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/agent/open")) {
      return new Response(
        JSON.stringify({
          accepts: [
            {
              rate: "0.0001",
              payTo: "0x0000000000000000000000000000000000000001",
              asset: "0x0000000000000000000000000000000000000002",
              network: "base-sepolia",
            },
          ],
          ok: true,
        }),
        { status: init?.headers && "X-PAYMENT" in init.headers ? 200 : 402 },
      );
    }
    return new Response(
      JSON.stringify({
        served: true,
        result: { tool: "preflight_base_transaction", result: { verdict: "safe" } },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const channel = await RemoteChannel.open({
      providerUrl: "https://provider.example.test",
      channelId: 42n,
      escrow: 1_000n,
      callToken: "channel-call-token",
      payment: "payment-proof",
    });
    const outcome = await channel.call({
      tool: "preflight_base_transaction",
      args: {
        chainId: 84532,
        from: "0x00000000000000000000000000000000000000aa",
        to: "0x00000000000000000000000000000000000000bb",
      },
    });

    assert.equal(outcome.cost, 1n);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RemoteChannel ignores malformed or decreasing cumulative unit reports", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/agent/open")) {
      return new Response(
        JSON.stringify({
          accepts: [
            {
              rate: "0.0001",
              payTo: "0x0000000000000000000000000000000000000001",
              asset: "0x0000000000000000000000000000000000000002",
              network: "base-sepolia",
            },
          ],
          ok: true,
        }),
        { status: init?.headers && "X-PAYMENT" in init.headers ? 200 : 402 },
      );
    }
    if (url.endsWith("/finalize")) return new Response(JSON.stringify({}), { status: 200 });
    calls++;
    return new Response(
      JSON.stringify({
        served: true,
        cumulativeUnits: calls === 1 ? "5" : calls === 2 ? "3" : "not-a-number",
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const channel = await RemoteChannel.open({
      providerUrl: "https://provider.example.test",
      channelId: 42n,
      escrow: 1_000n,
      callToken: "channel-call-token",
      payment: "payment-proof",
    });
    const request = {
      tool: "preflight_base_transaction",
      args: {
        chainId: 84532,
        from: "0x00000000000000000000000000000000000000aa",
        to: "0x00000000000000000000000000000000000000bb",
      },
    };

    assert.equal((await channel.call(request)).cost, 5n);
    assert.equal((await channel.call(request)).cost, 1n);
    assert.equal((await channel.call(request)).cost, 1n);
    assert.equal((await channel.close()).totalUnits, 5n);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
