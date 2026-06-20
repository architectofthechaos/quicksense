import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Air-gapped: no remote images / CDNs. Standalone output for the kind Dockerfile.
  output: "standalone",
};

export default nextConfig;
