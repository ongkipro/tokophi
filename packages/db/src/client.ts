import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Consumers (Next apps, seed, scripts) must have DATABASE_URL in their env.
// Local dev: postgresql://tokophi:tokophi@localhost:5433/tokophi (docker compose up -d db).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("[@tokophi/db] DATABASE_URL is not set");

// Reuse one pool across HMR / serverless invocations.
const globalForDb = globalThis as unknown as { _tokophiPg?: ReturnType<typeof postgres> };
const client = globalForDb._tokophiPg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb._tokophiPg = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema, client };
