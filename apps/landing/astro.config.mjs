import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

// TokoΦ landing (apex tokophi.com + www) — the platform's front door.
// STATIC on purpose: no DB, no DATABASE_URL, no per-request state. This page must be servable
// even when everything else is down. The @astrojs/node adapter is here ONLY to serve the
// prerendered output from a single `node dist/server/entry.mjs` process (binds IPv4 0.0.0.0),
// consistent with apps/storefront. Every route is prerendered (output: "static").
export default defineConfig({
  site: "https://tokophi.com",
  output: "static",
  adapter: node({ mode: "standalone" }),
  vite: {
    plugins: [tailwindcss()],
  },
});
