import { parseAbi } from "viem";

/**
 * Contract ABIs, generated from `forge inspect` via
 * `scripts/generate-abi.mjs`. Regenerating is the only way these stay
 * honest — the test in `abi.test.ts` compares them to a fresh inspect.
 *
 * ERC-20 is not one of ours, so it stays as a human-readable fragment.
 */
export { escrowAbi } from "./generated/escrowAbi.js";
export { registryAbi } from "./generated/registryAbi.js";
export { verifierAbi } from "./generated/verifierAbi.js";

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
