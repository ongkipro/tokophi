import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tokophi/ui", "@tokophi/lib", "@tokophi/db"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
