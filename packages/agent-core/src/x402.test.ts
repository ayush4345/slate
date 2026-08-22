import assert from "node:assert/strict";
import { test } from "node:test";

import {
  build402Body,
  buildTerms,
  decodePayment,
  discoverTerms,
  encodePayment,
  FacilitatorPaymentVerifier,
  fetchWithPayment,
  MockPaymentVerifier,
  paymentVerifierFromEnv,
  readPaymentHeader,
  x402ConfigFromEnv,
  x402Network,
  type X402Config,
} from "./x402.js";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAY_TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const config: X402Config = {
  network: "base-sepolia",
  asset: USDC,
  payTo: PAY_TO,
  rate: "0.0001",
  maxAmount: 100_000_000n,
};

test("x402Network names the chains a facilitator settles on", () => {
  assert.equal(x402Network(8453), "base");
  assert.equal(x402Network(84532), "base-sepolia");
});

/// Anvil has no facilitator. Saying so beats advertising terms nobody can pay.
test("x402Network refuses a chain with no facilitator", () => {
  assert.throws(() => x402Network(31337), /chain 31337 has no x402 network/);
});

test("terms advertise checksummed addresses and the amount as a string", () => {
  const terms = buildTerms({ ...config, asset: USDC.toLowerCase() as `0x${string}` });
  assert.equal(terms.asset, USDC, "lowercase in, checksummed out");
  assert.equal(terms.maxAmountRequired, "100000000");
  assert.equal(terms.scheme, "exact");
  assert.equal(terms.rate, "0.0001");
});

test("terms reject a price that is not an amount", () => {
  assert.throws(() => buildTerms({ ...config, rate: "free" }), /rate must be a decimal amount/);
  assert.throws(() => buildTerms({ ...config, maxAmount: 0n }), /maxAmount must be positive/);
});

test("a 402 body carries exactly one set of terms", () => {
  const body = build402Body(config);
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts.length, 1);
  assert.equal(body.accepts[0]!.payTo, PAY_TO);
});

test("payment headers round-trip", () => {
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: "base-sepolia",
    payload: { authorization: "sig" },
  } as const;
  assert.deepEqual(decodePayment(encodePayment(payload)), payload);
});

test("a malformed payment header is refused, not ignored", () => {
  assert.throws(() => decodePayment("not-base64-json"), /not base64-encoded JSON/);
  assert.throws(
    () => decodePayment(Buffer.from(JSON.stringify({ scheme: "upto" })).toString("base64")),
    /missing an `exact` scheme authorization/,
  );
});

test("readPaymentHeader is case-insensitive and ignores blanks", () => {
  assert.equal(readPaymentHeader({ "X-Payment": "abc" }), "abc");
  assert.equal(readPaymentHeader({ "x-payment": "" }), null);
  assert.equal(readPaymentHeader({}), null);
});

/// The mock accepts payment, but not payment for a different chain.
test("MockPaymentVerifier checks the network it was offered", async () => {
  const verifier = new MockPaymentVerifier();
  const terms = buildTerms(config);
  const pay = (network: "base" | "base-sepolia") =>
    encodePayment({ x402Version: 1, scheme: "exact", network, payload: { authorization: "sig" } });

  const accepted = await verifier.verifyAndSettle(pay("base-sepolia"), terms);
  assert.equal(accepted.ok, true);
  assert.match((accepted as { settlementTx: string }).settlementTx, /^mock_settle_/);

  const wrongChain = await verifier.verifyAndSettle(pay("base"), terms);
  assert.equal(wrongChain.ok, false);
  assert.match((wrongChain as { reason: string }).reason, /payment is for base, terms are base-sepolia/);
});

/// A resource server answers 402 for a bad header. Throwing would turn a
/// declined payment into a 500.
test("a malformed header is a declined payment, not a thrown error", async () => {
  const result = await new MockPaymentVerifier().verifyAndSettle("not-base64", buildTerms(config));
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /base64/);
});

test("FacilitatorPaymentVerifier verifies, then settles", async () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(init.body as string) });
    return new Response(
      JSON.stringify(url.endsWith("/verify") ? { isValid: true } : { success: true, txHash: "0xabc" }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const header = encodePayment({
    x402Version: 1,
    scheme: "exact",
    network: "base-sepolia",
    payload: { authorization: "sig" },
  });
  const verifier = new FacilitatorPaymentVerifier("https://facilitator.example/", fetchImpl);

  const result = await verifier.verifyAndSettle(header, buildTerms(config));
  assert.deepEqual(result, { ok: true, settlementTx: "0xabc" });
  assert.deepEqual(
    seen.map((s) => s.url),
    ["https://facilitator.example/verify", "https://facilitator.example/settle"],
    "verify first, and no doubled slash",
  );
  assert.equal((seen[0]!.body.paymentRequirements as { asset: string }).asset, USDC);
});

/// The reason has to name what went wrong. A bare "declined" would look
/// identical to a payment the facilitator actually rejected.
test("a facilitator that errors declines with a reason naming the status", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const verifier = new FacilitatorPaymentVerifier("https://facilitator.example", fetchImpl);
  const header = encodePayment({
    x402Version: 1,
    scheme: "exact",
    network: "base-sepolia",
    payload: { authorization: "sig" },
  });
  const result = await verifier.verifyAndSettle(header, buildTerms(config));
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /verify-failed-500/);
});

test("fetchWithPayment retries a 402 exactly once, with the header", async () => {
  const calls: Array<string | null> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.push(new Headers(init?.headers).get("x-payment"));
    return new Response("{}", { status: calls.length === 1 ? 402 : 200 });
  }) as unknown as typeof fetch;

  const res = await fetchWithPayment("https://provider.example/agent/open", {
    init: { method: "POST", headers: { "content-type": "application/json" } },
    network: "base-sepolia",
    authorization: "sig",
    fetchImpl,
  });

  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], null, "the first request is unpaid");
  assert.equal(decodePayment(calls[1]!).payload.authorization, "sig");
});

test("fetchWithPayment leaves a non-402 alone", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  await fetchWithPayment("https://provider.example/x", {
    network: "base",
    authorization: "sig",
    fetchImpl,
  });
  assert.equal(calls, 1);
});

test("discoverTerms reads accepts[0], or null when not gated", async () => {
  const gated = (async () =>
    new Response(JSON.stringify(build402Body(config)), { status: 402 })) as unknown as typeof fetch;
  const open = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

  assert.equal((await discoverTerms("https://p.example", gated))!.payTo, PAY_TO);
  assert.equal(await discoverTerms("https://p.example", open), null);
});

test("advertised terms come from the environment, and the payee is required", () => {
  const env = { X402_PAY_TO: PAY_TO } as NodeJS.ProcessEnv;
  const fromEnv = x402ConfigFromEnv(84532, env);
  assert.equal(fromEnv.network, "base-sepolia");
  assert.equal(fromEnv.payTo, PAY_TO);
  assert.equal(fromEnv.asset, USDC, "defaults to USDC on Base Sepolia");
  assert.equal(fromEnv.maxAmount, 100_000_000n);

  assert.throws(() => x402ConfigFromEnv(84532, { X402_ASSET: USDC }), /X402_PAY_TO is required/);
  assert.throws(
    () => x402ConfigFromEnv(84532, { ...env, X402_PAY_TO: "GABCDEF" }),
    /X402_PAY_TO must be a 20-byte address/,
  );
});

test("the verifier is mock until MOCK_X402 says otherwise", () => {
  assert.ok(paymentVerifierFromEnv({}) instanceof MockPaymentVerifier);
  assert.ok(
    paymentVerifierFromEnv({ MOCK_X402: "false" }) instanceof FacilitatorPaymentVerifier,
  );
});
