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
  transpilePackages: ["@tokophi/ui", "@tokophi/lib", "@tokophi/db"],
  serverExternalPackages: ["postgres"],
  // The platform control plane (rich.tokophi.com) must never be indexed. `headers()` matches
  // BEFORE the filesystem, so this covers every route incl. API routes and non-HTML responses
  // that a <meta> tag can't reach. (middleware.ts adds the same header to its own redirects.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, ...SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
