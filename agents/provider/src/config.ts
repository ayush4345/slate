import { x402ConfigFromEnv, type X402Config } from "@avtar/agent-core";

/** Runtime config for the provider's x402 HTTP server (read from env). */
export interface ProviderServerConfig {
  port: number;
  /** What the provider advertises in its 402. */
  terms: X402Config;
  /** When true, accept any well-formed payment instead of asking a facilitator. */
  mockX402: boolean;
  facilitatorUrl?: string;
}

export function readProviderServerConfig(env: NodeJS.ProcessEnv = process.env): ProviderServerConfig {
  const chainId = env.BASE_CHAIN_ID ? Number(env.BASE_CHAIN_ID) : 84532;
  return {
    port: Number(env.PORT ?? "4021"),
    terms: x402ConfigFromEnv(chainId, env),
    mockX402: (env.MOCK_X402 ?? "true") !== "false",
    ...(env.X402_FACILITATOR_URL ? { facilitatorUrl: env.X402_FACILITATOR_URL } : {}),
  };
}
