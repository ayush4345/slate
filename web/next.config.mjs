/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript sources built by tsc; Next must
  // transpile them rather than treat them as prebuilt node_modules.
  transpilePackages: [
    "@avtar/agent-core",
    "@avtar/onchain-setup",
    "@avtar/agent-provider",
    "@avtar/agent-consumer",
    "@avtar/proving-setup",
  ],
  serverExternalPackages: ["openai"],
};

export default nextConfig;
