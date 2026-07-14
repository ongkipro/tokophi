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
for (const key of ["DATABASE_URL", "STORE_SLUG", "DEFAULT_STORE_SLUG", "STOREFRONT_BASE_DOMAIN"]) {
  if (env[key]) process.env[key] ??= env[key];
}

export default defineConfig({
  site: "https://batiknusantara.id",
  output: "server",
  adapter: node({ mode: "standalone" }),
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ["postgres"] },
  },
});
