import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";

// The storefront reads the shared Postgres in .astro frontmatter (build/SSR time).
// @indostore/db/client.ts reads process.env.DATABASE_URL — Vite's .env only populates
// import.meta.env, so surface it onto process.env here (config runs before rendering).
const env = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
process.env.DATABASE_URL ??= env.DATABASE_URL;

export default defineConfig({
  site: "https://batiknusantara.id",
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ["postgres"] },
  },
});
