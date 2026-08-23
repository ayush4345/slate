import assert from "node:assert/strict";
import { test } from "node:test";

import type { CallOutcome, CloseResult, MeteredServiceChannel, ToolCall, ToolResult } from "@avtar/agent-core";
import type { AgentBrain } from "./agent.js";
import { AgentSession } from "./session.js";

class PreflightBrain implements AgentBrain {
  async decide(_goal: string, _tools: never[], gathered: ToolResult[]) {
    if (gathered.length > 0) return { answer: "Preflight complete." };
    return {
      calls: [{
        tool: "preflight_base_transaction",
        args: {
          chainId: 84532,
          from: "0x00000000000000000000000000000000000000aa",
          to: "0x00000000000000000000000000000000000000bb",
          data: "0x",
          value: "0",
        },
      }],
    };
  }
}

class FakeLocalChannel implements MeteredServiceChannel<ToolCall, ToolResult> {
  readonly channelId = 1n;
  readonly rate = 7n;
  readonly escrow = 100n;

  async call(request: ToolCall): Promise<CallOutcome<ToolCall, ToolResult>> {
    assert.deepEqual(request, {
      tool: "preflight_base_transaction",
      args: {
        chainId: 84532,
        from: "0x00000000000000000000000000000000000000aa",
        to: "0x00000000000000000000000000000000000000bb",
        data: "0x",
        value: "0",
      },
    });
    return {
      served: true,
      request,
      cost: 2n,
      cumulativeUnits: 2n,
      billable: 14n,
      result: {
        tool: "preflight_base_transaction",
        result: { verdict: "safe", gasEstimate: "21000" },
      },
    };
  }

  async close(): Promise<CloseResult> {
    return { totalUnits: 2n, settlementAmount: 14n, escrow: this.escrow };
  }
}

test("AgentSession retains call cost and settles provider totals from cost times rate", async () => {
  const session = new AgentSession(
    {
      port: 0,
      providerUrl: "http://local.test",
      corsOrigin: "http://local.test",
      rate: "0.000007",
      escrow: "0.0001",
      paymentSignature: "test",
    },
    { channel: new FakeLocalChannel(), brain: new PreflightBrain() },
  );
  await session.initialize();

  const result = await session.chat("preflight test");
  const preflight = result.calls[0];
  const provider = result.payment.providers.find((item) => item.tool === "preflight_base_transaction");

  assert.equal(preflight?.cost, 2n);
  assert.equal(result.payment.turnBillable, "14");
  assert.equal(result.payment.sessionBillable, "14");
  assert.equal(provider?.turnBillable, "14");
  assert.equal(provider?.sessionBillable, "14");
  assert.match(JSON.stringify(result.calls), /"cost":"2"/);
});
