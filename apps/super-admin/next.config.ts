import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tokophi/ui", "@tokophi/lib", "@tokophi/db"],
  serverExternalPackages: ["postgres"],
  // The platform control plane (rich.tokophi.com) must never be indexed. `headers()` matches
  // BEFORE the filesystem, so this covers every route incl. API routes and non-HTML responses
  // that a <meta> tag can't reach. (middleware.ts adds the same header to its own redirects.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
