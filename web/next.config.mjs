/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages ship TypeScript sources built by tsc, so Next needs
  // to transpile them rather than treat them as prebuilt node_modules.
  transpilePackages: ["@avtar/agent-core", "@avtar/onchain-setup"],
};

export default nextConfig;
