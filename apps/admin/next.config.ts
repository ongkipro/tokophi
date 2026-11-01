import type { NextConfig } from "next";
import path from "node:path";

// Browser-side hardening (2026-11 review item 5). None of these is set by Cloudflare, so a live
// `curl -I` showed only HSTS. Nothing in this app is ever framed by another origin (the theme
// preview is a same-origin portal into an src-less iframe), so DENY costs nothing and closes
// clickjacking on the credential/payout screens. CSP is deliberately NOT here: it needs a
// Report-Only rollout first.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "../../"),
  },
  transpilePackages: ["@tokophi/db", "@tokophi/lib", "@tokophi/sections", "@tokophi/ui"],
  serverExternalPackages: ["postgres", "sharp"],
  // The whole merchant admin (app.tokophi.com) must stay out of search engines: login, /daftar,
  // the Akun/credential screens, printable /faktur/*, every /api/* route and every uploaded file.
  // `headers()` matches BEFORE the filesystem, so this covers API routes, /public assets and
  // non-HTML responses that a <meta> tag can never reach. (middleware.ts adds the same header to
  // its own redirects/rewrites, which short-circuit before this config is applied.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, ...SECURITY_HEADERS],
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
