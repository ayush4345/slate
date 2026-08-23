import assert from "node:assert/strict";
import { test } from "node:test";

import { publicClientForChain } from "./index.js";

test("creates a Base mainnet public client using its public RPC URL", () => {
  const client = publicClientForChain(8453, {});

  assert.equal(client.chain?.id, 8453);
  assert.equal(client.transport.url, "https://mainnet.base.org");
});

test("uses BASE_RPC_URL when BASE_CHAIN_ID matches the requested chain", () => {
  const client = publicClientForChain(8453, {
    BASE_CHAIN_ID: "8453",
    BASE_RPC_URL: "https://mainnet.example.test",
  });

  assert.equal(client.transport.url, "https://mainnet.example.test");
});

test("uses BASE_RPC_URL when BASE_CHAIN_ID has whitespace or leading zeroes", () => {
  const client = publicClientForChain(8453, {
    BASE_CHAIN_ID: " 08453 ",
    BASE_RPC_URL: "https://mainnet.example.test",
  });

  assert.equal(client.transport.url, "https://mainnet.example.test");
});

test("creates a Base Sepolia public client using its public RPC URL", () => {
  const client = publicClientForChain(84532, {});

  assert.equal(client.chain?.id, 84532);
  assert.equal(client.transport.url, "https://sepolia.base.org");
});

test("rejects an unsupported chain", () => {
  assert.throws(() => publicClientForChain(31337, {}), /not a supported chain/);
});

test("does not use a Base-mainnet RPC override for a Base Sepolia request", () => {
  const client = publicClientForChain(84532, {
    BASE_CHAIN_ID: "8453",
    BASE_RPC_URL: "https://mainnet.example.test",
  });

  assert.equal(client.transport.url, "https://sepolia.base.org");
});

test("ignores signer, Slate address, and mock configuration", () => {
  const client = publicClientForChain(84532, {
    EVM_PRIVATE_KEY: "0xnot-a-private-key",
    SLATE_ESCROW_ADDRESS: "not-an-address",
    SLATE_REGISTRY_ADDRESS: "also-not-an-address",
    SLATE_MOCK: "true",
  });

  assert.equal(client.chain?.id, 84532);
  assert.equal(client.transport.url, "https://sepolia.base.org");
});
