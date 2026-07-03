import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@indostore/data", "@indostore/db"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
