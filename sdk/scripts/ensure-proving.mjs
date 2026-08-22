#!/usr/bin/env node
/**
 * Produce a Groth16 proving key that matches a freshly exported verifier.
 *
 * The committed `src/Verifier.sol` was generated from `settlement_final.zkey`,
 * which is not in git. This script builds a local key from the same r1cs so
 * the anvil e2e can prove and settle. The resulting verifier is deployed only
 * in that e2e — it does not replace the committed one.
 *
 *   node sdk/scripts/ensure-proving.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cacheDir = join(repoRoot, "sdk/.cache");
const provingRoot = process.env.PROVING_SETUP ?? join(repoRoot, "../slate/packages/proving-setup");

const r1cs = join(provingRoot, "settlement.r1cs");
const ptau = join(cacheDir, "powersOfTau28_hez_final_14.ptau");
const zkey = join(cacheDir, "settlement_final.zkey");
const verifierSol = join(cacheDir, "Groth16Verifier.sol");
const ptauUrl = "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau";

const snarkjs = existsSync(join(provingRoot, "node_modules/snarkjs/cli.js"))
  ? join(provingRoot, "node_modules/snarkjs/cli.js")
  : join(provingRoot, "node_modules/.bin/snarkjs");

mkdirSync(cacheDir, { recursive: true });

if (!existsSync(r1cs)) {
  throw new Error(`settlement.r1cs not found at ${r1cs} (set PROVING_SETUP)`);
}
if (!existsSync(snarkjs)) {
  throw new Error(`snarkjs CLI not found at ${snarkjs} — run pnpm install in proving-setup`);
}

if (!existsSync(ptau)) {
  console.log(`downloading ptau → ${ptau}`);
  execFileSync("curl", ["-L", "--fail", "--retry", "3", "-o", ptau, ptauUrl], { stdio: "inherit" });
}

if (!existsSync(zkey)) {
  console.log("groth16 setup (local e2e key — not a production ceremony)");
  execFileSync(
    "node",
    [snarkjs, "groth16", "setup", r1cs, ptau, zkey, "-e=slate-base-e2e"],
    { stdio: "inherit" },
  );
}

if (!existsSync(verifierSol)) {
  console.log(`export solidity verifier → ${verifierSol}`);
  execFileSync("node", [snarkjs, "zkey", "export", "solidityverifier", zkey, verifierSol], {
    stdio: "inherit",
  });
}

console.log(
  JSON.stringify(
    {
      zkey,
      verifierSol,
      wasm: join(provingRoot, "settlement_js/settlement.wasm"),
      provingRoot,
    },
    null,
    2,
  ),
);
