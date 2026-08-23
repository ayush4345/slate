import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { escrowAbi, registryAbi, verifierAbi } from "./abi.js";

/** `forge` runs where foundry.toml is — resolved from `dist/`, not `src/`. */
const forgeRoot = fileURLToPath(new URL("../evm/", import.meta.url));

function inspect(contract: string): unknown {
  const raw = execFileSync("forge", ["inspect", contract, "abi", "--json"], {
    cwd: forgeRoot,
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

test("escrowAbi matches forge inspect AvtarEscrow", () => {
  assert.deepEqual(escrowAbi, inspect("AvtarEscrow"));
});

test("registryAbi matches forge inspect AvtarAgentRegistry", () => {
  assert.deepEqual(registryAbi, inspect("AvtarAgentRegistry"));
});

test("verifierAbi matches forge inspect Groth16Verifier", () => {
  assert.deepEqual(verifierAbi, inspect("Groth16Verifier"));
});

test("generated ABIs cover the read-path surface", () => {
  const names = (abi: readonly { type: string; name?: string }[]): Set<string> =>
    new Set(abi.filter((item) => item.type === "function").map((item) => item.name ?? ""));
  const escrow = names(escrowAbi);
  const registry = names(registryAbi);
  const verifier = names(verifierAbi);

  for (const name of ["balanceOf", "verifier", "registry", "deposit", "settle"]) {
    assert.ok(escrow.has(name), `escrow missing ${name}`);
  }
  for (const name of ["getChannel", "hasChannel", "registerChannel", "validateForSettlement"]) {
    assert.ok(registry.has(name), `registry missing ${name}`);
  }
  assert.ok(verifier.has("verifyProof"));
});
