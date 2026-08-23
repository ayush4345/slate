import assert from "node:assert/strict";
import { test } from "node:test";

import { StubAgentBrain } from "./stub-agent.js";
import { buildAgentSteps } from "./steps.js";

const brain = new StubAgentBrain();

test("StubAgentBrain routes weather + crypto + translation in one turn", async () => {
  const decision = await brain.decide(
    "What's the weather in Tokyo, the price of ETH, and translate 'hello' into French?",
    [],
    [],
  );
  const tools = (decision.calls ?? []).map((c) => c.tool);
  assert.ok(tools.includes("get_weather"));
  assert.ok(tools.includes("get_crypto_price"));
  assert.ok(tools.includes("translate_text"));
});

test("StubAgentBrain summarises gathered results", async () => {
  const decision = await brain.decide("done?", [], [
    { tool: "get_weather", result: { location: "Tokyo", temperatureC: 22, summary: "clear sky" } },
  ]);
  assert.match(decision.answer ?? "", /Tokyo/);
  assert.equal(decision.calls, undefined);
});

test("StubAgentBrain builds a Base Sepolia preflight from the deterministic command", async () => {
  const decision = await brain.decide(
    "preflight 0x00000000000000000000000000000000000000aa 0x00000000000000000000000000000000000000bb 0xdeadbeef 42",
    [],
    [],
  );

  assert.deepEqual(decision.calls, [{
    tool: "preflight_base_transaction",
    args: {
      chainId: 84532,
      from: "0x00000000000000000000000000000000000000aa",
      to: "0x00000000000000000000000000000000000000bb",
      data: "0xdeadbeef",
      value: "42",
    },
  }]);
});

test("StubAgentBrain defaults omitted preflight calldata and value", async () => {
  const decision = await brain.decide(
    "preflight 0x00000000000000000000000000000000000000aa 0x00000000000000000000000000000000000000bb",
    [],
    [],
  );

  assert.deepEqual(decision.calls?.[0]?.args, {
    chainId: 84532,
    from: "0x00000000000000000000000000000000000000aa",
    to: "0x00000000000000000000000000000000000000bb",
    data: "0x",
    value: "0",
  });
});

test("StubAgentBrain returns guidance rather than an invalid call for malformed preflight commands", async () => {
  const decision = await brain.decide("preflight 0xnot-an-address", [], []);

  assert.equal(decision.calls, undefined);
  assert.match(decision.answer ?? "", /preflight <from-address> <to-address> \[calldata-hex\] \[value-wei\]/);
});

test("preflight steps show the advisory verdict and gas estimate", () => {
  const steps = buildAgentSteps(
    { name: "local", url: "http://local.test" },
    [{
      tool: "preflight_base_transaction",
      args: {},
      served: true,
      result: { verdict: "safe", gasEstimate: "21000" },
    }],
    "done",
    {
      turnCalls: 1,
      turnBillable: "14",
      sessionCalls: 1,
      sessionBillable: "14",
      tokenSymbol: "USDC",
      providers: [],
    },
  );

  assert.match(steps[1]?.summary ?? "", /Verdict: safe · Gas estimate: 21000/);
  assert.match(steps[1]?.summary ?? "", /not a safety guarantee/i);
});
