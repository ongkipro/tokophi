import { sql } from "drizzle-orm";
import { appDb, assertRestrictedDbIdentity, db } from "./client";

// Run `fn` inside a transaction scoped to a single tenant.
//   1. on the RESTRICTED pool where one exists (app-role mode), the owner pool otherwise,
//   2. sets the `app.store_id` GUC (transaction-local) that RLS policies read, and
//   3. switches to the non-owner `tokophi_app` role so the policies are ENFORCED.
// Every merchant read (`lib/data/*` via `withCurrentTenant`) and write (`lib/actions/*`) comes
// through here — 79 files. `fn` receives the transaction handle; run all tenant queries through it.
// Step 3 stays even when step 1 already connected as `tokophi_app` (setting the role to yourself is
// a no-op Postgres allows), because it is what makes local dev and owner-mode surfaces enforce too.
//
// ⚠️ THE POOL IS THE POINT NOW (Task 4.12). This runs on `appDb` — the RESTRICTED pool in app-role
// mode, the same owner pool everywhere else — never on `db`. `SET LOCAL ROLE` restricts INSIDE this
// transaction even on an owner connection, which is what has enforced RLS for merchant traffic all
// along; what it cannot do is survive a `RESET ROLE`, and it says nothing about a connection that is
// a superuser to begin with. On the restricted pool the login role itself has no superuser and no
// BYPASSRLS, so there is nothing to reset back to.
//
// What this still does NOT close: every path that never comes here — auth's pre-session read, the
// public API, the cron sweeps, `lib/provision.ts`, the cross-tenant control plane and the
// Host-resolved storefront catalog. Those are on `db` deliberately and cannot move: measured on
// production as `tokophi_app` with no tenant GUC, `stores`/`store_users`/`products` all return ZERO
// rows (RLS filtering, not a missing grant), so moving them would delete the login page, 404 every
// shop and empty the control plane.
//
// The gate is memoised in `client.ts`, so this await costs one round trip per PROCESS, not per
// transaction, and resolves instantly wherever there is no separate restricted pool.
export async function withTenant<T>(storeId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  await assertRestrictedDbIdentity();
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
    await tx.execute(sql`set local role tokophi_app`);
    return fn(tx as unknown as typeof db);
  });
}
