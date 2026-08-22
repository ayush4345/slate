import assert from "node:assert/strict";
import { test } from "node:test";

import { formatUnits, parseUnits } from "./money.js";

test("parseUnits / formatUnits round-trip USDC (6 decimals)", () => {
  assert.equal(parseUnits("0.0001"), 100n);
  assert.equal(parseUnits("0.01"), 10_000n);
  assert.equal(parseUnits("1"), 1_000_000n);
  assert.equal(formatUnits(100n), "0.0001");
  assert.equal(formatUnits(10_000n), "0.01");
  assert.equal(formatUnits(1_000_000n), "1");
});

test("parseUnits rejects junk", () => {
  assert.throws(() => parseUnits("-1"), /invalid decimal/);
  assert.throws(() => parseUnits("abc"), /invalid decimal/);
});
