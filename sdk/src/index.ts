// @slate-base/sdk — drives the Slate settlement contracts on Base.
//
// `settlement.ts` is pure: snarkjs output in, verifier calldata out, plus the
// address packing the circuit expects. `client.ts` puts it on chain.

export * from "./settlement.js";
export * from "./client.js";
export * from "./env.js";
export * from "./reads.js";
export {
  evmAddressToPayload,
  ensureProvingArtifacts,
  pinChannelTerms,
  proveSettlement,
} from "./prove.js";
export type { ProvingArtifacts, ProveArgs, BuiltChannelTerms } from "./prove.js";
export { erc20Abi, escrowAbi, registryAbi, verifierAbi } from "./abi.js";
