import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Consumers (Next apps, seed, scripts) must have DATABASE_URL in their env.
// Local dev: postgresql://indostore:indostore@localhost:5433/indostore (docker compose up -d db).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("[@indostore/db] DATABASE_URL is not set");

// Reuse one pool across HMR / serverless invocations.
const globalForDb = globalThis as unknown as { _indostorePg?: ReturnType<typeof postgres> };
const client = globalForDb._indostorePg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb._indostorePg = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema, client };
