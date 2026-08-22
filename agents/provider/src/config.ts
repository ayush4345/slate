/** Runtime config for the provider's x402 HTTP server (read from env). */
export interface ProviderServerConfig {
  port: number;
  network: string;
  asset: string;
  payTo: string;
  /** Per-unit rate in the settlement token's decimal units (e.g. "0.0001"). */
  rate: string;
  maxAmount: string;
  mockX402: boolean;
  facilitatorUrl: string;
}

export function readProviderServerConfig(env: NodeJS.ProcessEnv = process.env): ProviderServerConfig {
  return {
    port: Number(env.PORT ?? "4021"),
    network: env.X402_NETWORK ?? "base-sepolia",
    asset: env.X402_ASSET ?? env.SETTLEMENT_TOKEN ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo:
      env.X402_PAY_TO ??
      env.PROVIDER_ADDRESS ??
      "0x0000000000000000000000000000000000000001",
    rate: env.RATE ?? "0.0001",
    maxAmount: env.X402_MAX_AMOUNT ?? "100000000",
    mockX402: (env.MOCK_X402 ?? "true") !== "false",
    facilitatorUrl: env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
  };
}
