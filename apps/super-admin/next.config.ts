import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@indostore/ui", "@indostore/lib", "@indostore/db"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
