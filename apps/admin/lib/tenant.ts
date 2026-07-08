import "server-only";
import { db, withTenant } from "@tokophi/db";
import { getSession } from "@/lib/auth";

// Runtime RLS enforcement for the merchant admin. Every read/write runs inside
// `withTenant`, which (per transaction) sets the `app.store_id` GUC and drops to the
// non-owner `tokophi_app` role so the Postgres RLS policies (migration 0012)
// actually enforce. The app process still connects as the owner, but each tenant
// query executes under the restricted role — mirroring the VPS/PostgREST model.
//
// NOT used by: auth (`lib/auth.ts` reads store_users before a session exists → must
// stay owner or it locks everyone out) and the super-admin app (cross-tenant/platform).

export type Tx = typeof db;

// Nil UUID → RLS matches no rows, so an unauthenticated call fails closed.
const NO_STORE = "00000000-0000-0000-0000-000000000000";

// Run a DB block scoped to the CURRENT user's store (from the session cookie).
// Use in `lib/data/*` reads, which run during RSC render where the session is present.
export async function withCurrentTenant<T>(fn: (db: Tx) => Promise<T>): Promise<T> {
  const session = await getSession();
  return withTenant(session?.storeId ?? NO_STORE, fn);
}

export { withTenant };
