import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Sql } from "postgres";
import * as schema from "./schema";

const LOCAL_DEV_URL = "postgresql://tokophi:tokophi@localhost:5433/tokophi";
const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL ?? ownerUrl;
const isProductionRuntime = process.env.NODE_ENV === "production";
const runtimeRole = isProductionRuntime && process.env.DATABASE_RUNTIME_ROLE === "app" ? "app" : "owner";

// Production defaults to the restricted app-role path. Only explicit owner-mode surfaces opt out:
// super-admin, host-resolved storefront reads, and migrations. Local dev/test still use DATABASE_URL
// (or the docker-compose localhost default) so the current workflow stays frictionless.
if (isProductionRuntime && runtimeRole === "app" && !appUrl) {
  throw new Error("[@tokophi/db] APP_DATABASE_URL or DATABASE_URL is required when DATABASE_RUNTIME_ROLE=app");
}
if (isProductionRuntime && runtimeRole === "owner" && !ownerUrl) {
  throw new Error("[@tokophi/db] DATABASE_URL is required when DATABASE_RUNTIME_ROLE=owner");
}
const url = isProductionRuntime
  ? runtimeRole === "app"
    ? appUrl!
    : ownerUrl!
  : ownerUrl ?? LOCAL_DEV_URL;

// Reuse one pool across HMR / serverless invocations.
const globalForDb = globalThis as unknown as { _tokophiPg?: Sql };
const client = globalForDb._tokophiPg ?? postgres(url, { max: 10 });
if (!isProductionRuntime) globalForDb._tokophiPg = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema, client };
