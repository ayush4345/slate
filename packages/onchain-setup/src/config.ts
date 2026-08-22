import type { Address, Chain } from "viem";
import { base, baseSepolia, foundry } from "viem/chains";

/** Where the settlement stack is deployed. */
export interface ContractAddresses {
  escrow: Address;
  registry: Address;
}

/** Chains settlement runs on. Base Sepolia is the default: a testnet with real
 *  Circle USDC and an x402 facilitator behind it. */
export const CHAINS = { base, baseSepolia, foundry } as const;

/** Keyed by id, for resolving a configured chain id. */
export const CHAINS_BY_ID = new Map<number, Chain>(
  Object.values(CHAINS).map((chain) => [chain.id, chain]),
);

/** Anvil advertises no public RPC of its own. */
export const DEFAULT_RPC_URLS: Record<number, string> = {
  [foundry.id]: "http://127.0.0.1:8545",
};

/** Circle USDC. Mirrors the constants in `evm/script/Deploy.s.sol`. */
export const USDC = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [baseSepolia.id]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const satisfies Record<number, Address>;

/**
 * USDC for a chain, where there is one. Anvil's token is deployed per-run, so
 * local runs have to name it.
 */
export function defaultToken(chainId: number): Address | undefined {
  return USDC[chainId as keyof typeof USDC];
}
