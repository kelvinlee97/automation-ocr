import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@claimflow/domain"],
  agentRules: false,
  experimental: { useTypeScriptCli: false }
};

export default nextConfig;
