import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";

// SSR (output: "server") so the container starts INSTANTLY (no build-at-start) and so ONE deploy
// serves EVERY store: src/middleware.ts resolves the tenant from the request's `Host` header and
// reads that store's catalog from Postgres per-request (cached, src/data/cache.ts) — never at
// build time. `astro build` must stay DB-free (the image is built without DATABASE_URL).
// @tokophi/db/client.ts reads process.env.DATABASE_URL (surfaced here for local dev; at runtime it
// comes from the container env).
const env = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");

// These are read with `process.env` at RUNTIME (src/data/store.ts — deliberately, so the Docker
// image can be built without env and still be configured by the container). Vite only ever puts
// `.env` into `import.meta.env`, so on `astro dev` they were simply absent: STORE_SLUG never
// reached the host→store fallback and `http://localhost:4327/` answered 404 ("Toko tidak
// ditemukan") for the one host a developer actually types. Surface them here, same as DATABASE_URL.
// `??=` — a real container env always wins.
for (const key of ["DATABASE_URL", "STORE_SLUG", "DEFAULT_STORE_SLUG", "STOREFRONT_BASE_DOMAIN", "ACCOUNT_APP_URL"]) {
  if (env[key]) process.env[key] ??= env[key];
}

export default defineConfig({
  // NO `site:`. This is ONE deploy serving EVERY merchant (ADR 0009) — a hardcoded origin here is a
  // platform-wide SEO self-destruct waiting for the first person to use `Astro.site` or @astrojs/sitemap:
  // every store would emit canonicals and sitemap URLs pointing at one specific merchant's domain, and
  // Google would de-index the rest as duplicates of a shop they don't own. The canonical origin is
  // per-request — see `Astro.locals.origin` (src/middleware.ts).
  output: "server",
  adapter: node({ mode: "standalone" }),
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ["postgres"] },
    // DEV ONLY. Vite's dev server blocks unknown Host headers (a DNS-rebinding guard), which makes it
    // impossible to test custom-domain resolution locally by faking the Host. Production runs the Node
    // adapter, which has no such allow-list — so this changes nothing there.
    server: { allowedHosts: [".test", "localhost", ".tokophi.com", ".sslip.io"] },
  },
});
