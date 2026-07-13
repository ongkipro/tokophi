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
process.env.DATABASE_URL ??= env.DATABASE_URL;

export default defineConfig({
  site: "https://batiknusantara.id",
  output: "server",
  adapter: node({ mode: "standalone" }),
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ["postgres"] },
  },
});
