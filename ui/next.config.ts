import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Air-gapped: no remote images / CDNs. Standalone output for the kind Dockerfile.
  output: "standalone",
  // Hide the Next.js dev-tools indicator (the stray "1 Issue" badge) — SPEC-004a punch-list.
  devIndicators: false,
};

export default nextConfig;
