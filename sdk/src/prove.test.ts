import assert from "node:assert/strict";
import { test } from "node:test";

import { evmAddressToPayload } from "./prove.js";
import { addressToFieldPair } from "./settlement.js";

test("evmAddressToPayload left-pads to 32 bytes that split back to the field pair", () => {
  const addr = "0xdeadbeef00000000000000000000000000000001";
  const payload = evmAddressToPayload(addr);
  assert.equal(payload.length, 32);
  for (let i = 0; i < 12; i++) assert.equal(payload[i], 0);

  const [hi, lo] = addressToFieldPair(addr);
  let recoveredHi = 0n;
  let recoveredLo = 0n;
  for (let i = 0; i < 16; i++) {
    recoveredHi = (recoveredHi << 8n) | BigInt(payload[i]!);
    recoveredLo = (recoveredLo << 8n) | BigInt(payload[16 + i]!);
  }
  assert.equal(recoveredHi, hi);
  assert.equal(recoveredLo, lo);
});
