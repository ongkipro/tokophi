import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tokophi/data", "@tokophi/db"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
