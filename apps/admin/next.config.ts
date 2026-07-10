import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tokophi/data", "@tokophi/db", "@tokophi/lib"],
  serverExternalPackages: ["postgres", "sharp"],
};

export default nextConfig;
