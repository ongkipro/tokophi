import { sql } from "drizzle-orm";
import { db } from "./client";

// Run `fn` inside a transaction scoped to a single tenant.
//   1. sets the `app.store_id` GUC (transaction-local) that RLS policies read, and
//   2. switches to the non-owner `indostore_app` role so the policies are ENFORCED.
// Use this once the app connects without owner privileges (the VPS / PostgREST path);
// locally the app still connects as the owner (which bypasses RLS) so this is opt-in.
// `fn` receives the transaction handle — run all tenant queries through it.
export async function withTenant<T>(storeId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
    await tx.execute(sql`set local role indostore_app`);
    return fn(tx as unknown as typeof db);
  });
}
