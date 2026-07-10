import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";

// SSR (output: "server") so the container starts INSTANTLY (no build-at-start) — the catalog is
// read from Postgres at server boot (module-level in data/catalog.ts), not during `astro build`.
// This removes the ~1-2 min deploy downtime the old SSG build-at-start caused.
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
