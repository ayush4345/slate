export interface ConsumerServerConfig {
  port: number;
  providerUrl: string;
  corsOrigin: string;
  rate: string;
  escrow: string;
  paymentSignature: string;
}

export function readConsumerServerConfig(env: NodeJS.ProcessEnv = process.env): ConsumerServerConfig {
  return {
    port: Number(env.CONSUMER_PORT ?? env.PORT ?? "4022"),
    providerUrl: env.PROVIDER_URL ?? "http://localhost:4021",
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:3000",
    rate: env.RATE ?? "0.0001",
    escrow: env.ESCROW ?? "0.01",
    paymentSignature: env.X402_PAYMENT_SIGNATURE ?? "demo-payment",
  };
}
