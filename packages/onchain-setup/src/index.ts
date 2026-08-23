// @avtar/onchain-setup — the deployed contracts, as TypeScript sees them.
//
// `evm/` holds the Solidity. Here: the generated ABIs, and where the stack is
// deployed.

export * from "./config.js";
export { erc20Abi, escrowAbi, registryAbi, verifierAbi } from "./abi.js";
