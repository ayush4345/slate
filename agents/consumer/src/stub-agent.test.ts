import assert from "node:assert/strict";
import { test } from "node:test";

import { StubAgentBrain } from "./stub-agent.js";

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
