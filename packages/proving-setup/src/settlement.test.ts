import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addressToFieldPair,
  fieldPairToAddress,
  partiesFromSignals,
  proofToCalldata,
  SettlementError,
  SIGNAL,
  toPublicSignals,
  toSettlement,
  type SnarkjsProof,
} from "./settlement.js";

const proof: SnarkjsProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["30", "31"],
    ["40", "41"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
  protocol: "groth16",
};

const signals = Array.from({ length: 13 }, (_, i) => String(i));

test("proofToCalldata keeps G1 points in order", () => {
  const { a, c } = proofToCalldata(proof);
  assert.deepEqual(a, [1n, 2n]);
  assert.deepEqual(c, [7n, 8n]);
});

/// The one thing that silently breaks verification if it drifts.
test("proofToCalldata swaps each G2 pair to imaginary-part-first", () => {
  const { b } = proofToCalldata(proof);
  assert.deepEqual(b, [
    [31n, 30n],
    [41n, 40n],
  ]);
});

test("proofToCalldata rejects a malformed proof rather than producing junk", () => {
  assert.throws(() => proofToCalldata({ ...proof, pi_a: ["1"] }), SettlementError);
  assert.throws(() => proofToCalldata({ ...proof, pi_b: [["1", "2"]] }), SettlementError);
  assert.throws(() => proofToCalldata({ ...proof, pi_c: ["x", "y"] }), SettlementError);
});

test("toPublicSignals requires exactly thirteen", () => {
  assert.equal(toPublicSignals(signals).length, 13);
  assert.throws(() => toPublicSignals(signals.slice(0, 12)), /expected 13 public signals/);
  assert.throws(() => toPublicSignals([...signals, "13"]), /received 14/);
});

test("toSettlement assembles both halves", () => {
  const settlement = toSettlement(proof, signals);
  assert.deepEqual(settlement.proof.a, [1n, 2n]);
  assert.equal(settlement.publicSignals[SIGNAL.nullifier], 4n);
});

/// Must agree with SignalAddress.sol: hi is the top 16 bytes of the
/// left-padded address, lo the bottom 16.
test("addressToFieldPair splits on the 16-byte boundary", () => {
  const [hi, lo] = addressToFieldPair("0xdeadbeef00000000000000000000000000000001");
  assert.equal(hi, 0xdeadbeefn);
  assert.equal(lo, 1n);
});

test("address field pairs round-trip", () => {
  for (const addr of [
    "0x0000000000000000000000000000000000000000",
    "0xffffffffffffffffffffffffffffffffffffffff",
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  ]) {
    const [hi, lo] = addressToFieldPair(addr);
    assert.equal(fieldPairToAddress(hi, lo), addr.toLowerCase());
  }
});

test("addressToFieldPair refuses anything that is not a 20-byte address", () => {
  assert.throws(() => addressToFieldPair("0x1234"), /20-byte address/);
  assert.throws(() => addressToFieldPair("GABCDEF"), /20-byte address/);
});

test("fieldPairToAddress refuses out-of-range halves", () => {
  assert.throws(() => fieldPairToAddress(1n << 33n, 0n), SettlementError);
  assert.throws(() => fieldPairToAddress(0n, 1n << 129n), SettlementError);
});

test("partiesFromSignals reads the three addresses back out", () => {
  const depositor = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const provider = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const token = "0x1234567890abcdef1234567890abcdef12345678";

  const raw = Array.from({ length: 13 }, () => 0n);
  [raw[SIGNAL.depositorHi], raw[SIGNAL.depositorLo]] = addressToFieldPair(depositor);
  [raw[SIGNAL.providerHi], raw[SIGNAL.providerLo]] = addressToFieldPair(provider);
  [raw[SIGNAL.tokenHi], raw[SIGNAL.tokenLo]] = addressToFieldPair(token);

  const parties = partiesFromSignals(toPublicSignals(raw));
  assert.equal(parties.depositor, depositor.toLowerCase());
  assert.equal(parties.provider, provider.toLowerCase());
  assert.equal(parties.token, token.toLowerCase());
});
