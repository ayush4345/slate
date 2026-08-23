import { createPublicClient, http, type PublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";

/** Creates a read-only client for a supported Base network. */
export function publicClientForChain(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env,
): PublicClient<ReturnType<typeof http>, typeof base | typeof baseSepolia> {
  const chain =
    chainId === base.id ? base : chainId === baseSepolia.id ? baseSepolia : undefined;
  if (chain === undefined) throw new Error(`chain ${chainId} is not a supported chain`);

  const rpcUrl =
    Number(env.BASE_CHAIN_ID) === chainId && env.BASE_RPC_URL
      ? env.BASE_RPC_URL
      : chain.rpcUrls.default.http[0];

  return createPublicClient({ chain, transport: http(rpcUrl) });
}
