// TokoΦ Account (`@tokophi/account`, ADR 0016): ONE origin (account.tokophi.com) for every shop's
// buyers. Astro SSR on the Node adapter, like apps/storefront — but NOT tenant-resolved: the account is
// cross-tenant, so there is no Host → store step here. Its session cookie is host-only on this origin
// and never shared with a storefront, a custom domain, or the Seller panel (ADR 0016 "central origin,
// not shared cookies").
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import { loadEnv } from "vite";

// Read with `process.env` at runtime (Docker configures the container); Vite only puts `.env` into
// `import.meta.env`, so surface the few this app reads for `astro dev`. `??=` — real env wins.
const env = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
for (const key of ["DATABASE_URL", "AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ACCOUNT_GOOGLE_REDIRECT_URI", "STOREFRONT_BASE_DOMAIN", "ACCOUNT_CLAIM_SECRET", "ADMIN_URL"]) {
  if (env[key]) process.env[key] ??= env[key];
}

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // Form POSTs are the whole write surface; Astro refuses a cross-origin POST (default, stated).
  security: { checkOrigin: true },
  // The dev toolbar floats over the bottom tab bar on a phone; this app is reviewed on phones.
  devToolbar: { enabled: false },
  vite: { ssr: { external: ["postgres"] } },
});
