import assert from "node:assert/strict";
import { test } from "node:test";

import { slateClientFromEnv } from "./env.js";

/** Anvil's first account — a well-known test key, never a real one. */
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPOSITOR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const full = {
  EVM_PRIVATE_KEY: KEY,
  SLATE_ESCROW_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  SLATE_REGISTRY_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
} as NodeJS.ProcessEnv;

test("no key means mock mode, not a crash", () => {
  assert.equal(slateClientFromEnv({}), null);
});

test("a key builds a client bound to the signer", () => {
  const setup = slateClientFromEnv(full)!;
  assert.equal(setup.depositor, DEPOSITOR);
  assert.equal(setup.provider, DEPOSITOR, "provider defaults to the depositor");
  assert.equal(setup.token, USDC, "defaults to USDC on Base Sepolia");
  assert.equal(setup.chain.id, 84532, "Base Sepolia by default");
  assert.equal(setup.client.address, DEPOSITOR);
});

test("every deployed address is required once the key is set", () => {
  for (const name of ["SLATE_ESCROW_ADDRESS", "SLATE_REGISTRY_ADDRESS"]) {
    const env = { ...full };
    delete env[name];
    assert.throws(() => slateClientFromEnv(env), new RegExp(`${name} is required`));
  }
});

/// The trap this replaces silently hashed anything that did not parse. Refusing
/// is the point: a corrupted address binds a proof to a payee that cannot be paid.
test("a malformed address is refused, not coerced", () => {
  assert.throws(
    () => slateClientFromEnv({ ...full, SETTLEMENT_TOKEN: "GABCDEF" }),
    /SETTLEMENT_TOKEN must be a 20-byte address/,
  );
});

/// Anvil's token is deployed per-run, so there is nothing to default to.
test("anvil must name its own token", () => {
  assert.throws(
    () => slateClientFromEnv({ ...full, BASE_CHAIN_ID: "31337" }),
    /SETTLEMENT_TOKEN is required on chain 31337/,
  );
});

test("anvil is selectable and defaults to the local node", () => {
  const setup = slateClientFromEnv({ ...full, BASE_CHAIN_ID: "31337", SETTLEMENT_TOKEN: USDC })!;
  assert.equal(setup.chain.id, 31337);
  assert.equal(setup.client.publicClient.transport.url, "http://127.0.0.1:8545");
});

test("an unknown chain id is refused", () => {
  assert.throws(() => slateClientFromEnv({ ...full, BASE_CHAIN_ID: "1" }), /not a supported chain/);
});
