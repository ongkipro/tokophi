import { defineConfig } from "drizzle-kit";

// DATABASE_URL is injected by the npm scripts via `dotenv -e ../../.env`.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case", // camelCase in TS → snake_case columns (matches docs/SCHEMA.md)
  dbCredentials: { url: process.env.DATABASE_URL! },
});
