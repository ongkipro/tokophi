import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "../../"),
  },
  transpilePackages: ["@tokophi/db", "@tokophi/lib", "@tokophi/sections", "@tokophi/ui"],
  serverExternalPackages: ["postgres", "sharp"],
  // `next dev` only: hosts allowed to load dev resources (HMR, client chunks) when the panel is opened
  // from another device, e.g. a Tailscale IP. Comma-separated; unset = Next's default (localhost only).
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map((h) => h.trim()).filter(Boolean),
  // The whole merchant admin (app.tokophi.com) must stay out of search engines: login, /daftar,
  // the Akun/credential screens, printable /faktur/*, every /api/* route and every uploaded file.
  // `headers()` matches BEFORE the filesystem, so this covers API routes, /public assets and
  // non-HTML responses that a <meta> tag can never reach. (middleware.ts adds the same header to
  // its own redirects/rewrites, which short-circuit before this config is applied.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      // EXCEPTION — merchant-uploaded media. These files live behind the admin app but are embedded
      // on the PUBLIC storefronts (storefront `mediaUrl()` rewrites /api/uploads/* onto the admin
      // origin), so they are shopper-facing product photos, not admin surface. Leaving the blanket
      // noindex on them would evict every merchant's product image from Google Images. `all` = no
      // indexing restrictions; a later rule with the same key overrides the earlier one.
      {
        source: "/api/uploads/:path*",
        headers: [{ key: "X-Robots-Tag", value: "all" }],
      },
    ];
  },
};

export default nextConfig;
