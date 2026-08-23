import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { addressToFieldPair, toSettlement, type Settlement } from "@avtar/proving-setup";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ensureScript = join(repoRoot, "packages/onchain-setup/scripts/ensure-proving.mjs");

export interface ProvingArtifacts {
  zkey: string;
  wasm: string;
  verifierSol: string;
  provingRoot: string;
}

export interface ProveArgs {
  channelId: bigint;
  channelSecret: bigint;
  rate: bigint;
  rateBlind: bigint;
  /** Metered units. Settlement amount is `totalUnits * rate`. */
  totalUnits: bigint;
  escrowAmount: bigint;
  depositor: `0x${string}`;
  provider: `0x${string}`;
  token: `0x${string}`;
  /** 32-byte Baby Jubjub consumer key. */
  consumerPrivateKey: Uint8Array;
  artifacts?: ProvingArtifacts;
}

export interface BuiltChannelTerms {
  rateCommitment: bigint;
  consumerPublicKey: { x: bigint; y: bigint };
  settlementAmount: bigint;
  nullifier: bigint;
}

/** Left-pad a 20-byte address to the 32-byte payload the circuit binds. */
export function evmAddressToPayload(address: `0x${string}`): Uint8Array {
  const [hi, lo] = addressToFieldPair(address);
  const out = new Uint8Array(32);
  let high = hi;
  let low = lo;
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(high & 0xffn);
    high >>= 8n;
    out[16 + i] = Number(low & 0xffn);
    low >>= 8n;
  }
  return out;
}

/**
 * Build a proving key + matching verifier Solidity, using the sibling
 * `proving-setup` r1cs. Cached under `.cache/`.
 */
export function ensureProvingArtifacts(): ProvingArtifacts {
  const printed = execFileSync("node", [ensureScript], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const start = printed.lastIndexOf("{");
  if (start < 0) throw new Error(`ensure-proving produced no JSON:\n${printed}`);
  const artifacts = JSON.parse(printed.slice(start)) as ProvingArtifacts;
  for (const [name, path] of Object.entries(artifacts)) {
    if (name !== "provingRoot" && !existsSync(path)) {
      throw new Error(`proving artifact missing (${name}): ${path}`);
    }
  }
  return artifacts;
}

async function loadProvingSetup(provingRoot: string) {
  const index = join(provingRoot, "dist/index.js");
  if (!existsSync(index)) {
    throw new Error(`proving-setup build missing at ${index} — run tsc -b there`);
  }
  return import(pathToFileURL(index).href) as Promise<{
    buildSettlementInputs: (params: Record<string, unknown>) => Promise<{
      rate_commitment: string;
      consumer_pubkey_x: string;
      consumer_pubkey_y: string;
      settlement_amount: string;
      nullifier: string;
      [key: string]: string;
    }>;
    generateSettlementProof: (
      inputs: Record<string, string>,
      options: { wasmPath: string; zkeyPath: string },
    ) => Promise<{
      proof: {
        pi_a: string[];
        pi_b: string[][];
        pi_c: string[];
        protocol?: string;
        curve?: string;
      };
      publicSignals: string[];
    }>;
  }>;
}

async function circuitInputs(args: ProveArgs, provingRoot: string) {
  const proving = await loadProvingSetup(provingRoot);
  const inputs = await proving.buildSettlementInputs({
    channelId: args.channelId,
    channelSecret: args.channelSecret,
    rate: args.rate,
    rateBlind: args.rateBlind,
    totalUnits: args.totalUnits,
    escrowAmount: args.escrowAmount,
    depositorPayload: evmAddressToPayload(args.depositor),
    providerPayload: evmAddressToPayload(args.provider),
    tokenPayload: evmAddressToPayload(args.token),
    consumerPrivateKey: args.consumerPrivateKey,
  });
  const terms: BuiltChannelTerms = {
    rateCommitment: BigInt(inputs.rate_commitment),
    consumerPublicKey: {
      x: BigInt(inputs.consumer_pubkey_x),
      y: BigInt(inputs.consumer_pubkey_y),
    },
    settlementAmount: BigInt(inputs.settlement_amount),
    nullifier: BigInt(inputs.nullifier),
  };
  return { proving, inputs, terms };
}

/**
 * Poseidon rate commitment + Baby Jubjub pubkey the registry must pin at
 * open. Same arguments later go to {@link proveSettlement}; the two calls
 * are deterministic for a fixed `channelSecret` / consumer key.
 *
 * Uses `totalUnits = 0` so this is cheap (no Groth16) and still produces
 * the commitments `openChannel` needs.
 */
export async function pinChannelTerms(
  args: Omit<ProveArgs, "totalUnits">,
): Promise<BuiltChannelTerms> {
  const artifacts = args.artifacts ?? ensureProvingArtifacts();
  const { terms } = await circuitInputs({ ...args, totalUnits: 0n }, artifacts.provingRoot);
  return terms;
}

/**
 * Assemble circuit inputs for a channel, then Groth16-prove them.
 *
 * `terms` is what `openChannel` must pin — compute it first with
 * {@link pinChannelTerms}, register, then call this with the same secrets
 * and the final metered `totalUnits`.
 */
export async function proveSettlement(args: ProveArgs): Promise<{
  settlement: Settlement;
  terms: BuiltChannelTerms;
}> {
  const artifacts = args.artifacts ?? ensureProvingArtifacts();
  const { proving, inputs, terms } = await circuitInputs(args, artifacts.provingRoot);

  const result = await proving.generateSettlementProof(inputs, {
    wasmPath: artifacts.wasm,
    zkeyPath: artifacts.zkey,
  });

  return { settlement: toSettlement(result.proof, result.publicSignals), terms };
}
