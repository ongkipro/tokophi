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
//
// ⚠️ `storeId` is handed to the callback for a reason — READ THIS BEFORE WRITING A QUERY HERE.
// RLS scopes the 36 tables that HAVE a `store_id` column. It does NOT scope `stores` itself: that
// table is keyed by `id`, has no `store_id`, and has `relrowsecurity = false`. `verify-rls` cannot
// catch it either — it derives the store-scoped set from the catalog by looking for a `store_id`
// column, so `stores` is invisible to the very guard meant to protect us.
//
// The consequence is not theoretical. Two shipped functions did
//     `db.select({...}).from(schema.stores).limit(1)`
// inside this wrapper, trusting RLS to pick the right row. It cannot. `limit(1)` returned an
// ARBITRARY store — in the dev DB, Kopi Senja — so Batik Nusantara's owner read a stranger's shop
// name, tagline, WhatsApp number and subscription countdown. Worse, `saveStoreProfile` writes with a
// correct `where id = storeId`, so pressing "Simpan Perubahan" without touching a field would have
// renamed their own shop to the leaked one. A read leak that becomes a write corruption on the most
// innocent possible action.
//
// So: any query against `stores` (or any other table without a `store_id`) MUST filter on this
// `storeId` explicitly. RLS is not a substitute for a WHERE clause on a table it does not police.
export async function withCurrentTenant<T>(fn: (db: Tx, storeId: string) => Promise<T>): Promise<T> {
  const session = await getSession();
  const storeId = session?.storeId ?? NO_STORE;
  return withTenant(storeId, (tx) => fn(tx, storeId));
}

export { withTenant };
