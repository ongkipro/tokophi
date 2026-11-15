// Affiliate TokoΦ (`@tokophi/affiliate`, ADR 0022): ONE origin (affiliate.tokophi.com) for every store's
// affiliates. Astro SSR on the Node adapter, like apps/account — NOT tenant-resolved: an affiliate account
// spans stores, so there is no Host → store step here. Its session cookie is host-only on this origin and
// is never shared with a storefront, the buyer account, or the Seller panel.
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

// Read with `process.env` at runtime (Docker configures the container); Vite only puts `.env` into
// `import.meta.env`, so surface the few this app reads for `astro dev`. `??=` — real env wins.
const env = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
for (const key of ["DATABASE_URL", "AFFILIATE_APP_URL", "STOREFRONT_BASE_DOMAIN"]) {
  if (env[key]) process.env[key] ??= env[key];
}

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // Form POSTs are the whole write surface; Astro refuses a cross-origin POST (default, stated).
  // `allowedDomains`: behind Traefik the node adapter trusts no Host / X-Forwarded-* header unless it is
  // listed, so a form POST from a browser that sends no `Sec-Fetch-Site` would fail the origin check
  // (the account app measured this; BUYER-ACCOUNT-DEPLOY).
  security: { checkOrigin: true, allowedDomains: [{ hostname: "affiliate.tokophi.com", protocol: "https" }] },
  devToolbar: { enabled: false },
  // `server-only` → empty module: see src/server-only.ts (the shared login limiter imports it).
  vite: {
    ssr: { external: ["postgres"] },
    resolve: { alias: { "server-only": fileURLToPath(new URL("./src/server-only.ts", import.meta.url)) } },
  },
});
