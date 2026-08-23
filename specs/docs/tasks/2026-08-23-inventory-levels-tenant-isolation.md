# Task 6.2 / F-T8 — `inventory_levels` gets its own RLS policy, through the ownership chain

**Status:** done · branch `sec/task-6.2-inventory-rls` · migration **0100**
**Requirement:** `F-T8` (root `TASKS.md` → Task 6.2) · related `SEC-1`, `F-T1`

## What was true before

`inventory_levels` was one of the **12 store-scoped child tables with no `store_id` and no RLS**, on
which `tokophi_app` holds full DML. Isolation was carried entirely by the application: the child-table
rule ("every id the row is keyed on must have been read back from an RLS-protected table inside the
same `withTenant` txn"). That rule is real and stays — but it is a convention, and this repo has
already shipped **five** cross-tenant bugs from that exact class. This table is the one where a miss
moves stock.

## The shape

**No denormalised `store_id` column.** TASKS.md permits one only if the policy cannot be made safe and
performant otherwise; it can. The policy derives ownership from the existing chain
(`inventory_levels.variant_id → product_variants.store_id`), both sides indexed and already joined by
every reader.

`packages/db/drizzle/0100_inventory_levels_rls.sql` — idempotent (`DROP POLICY IF EXISTS` first, per
the repo rule that drizzle applies the whole pending batch in ONE transaction):

- `USING` — the variant must belong to `app_current_store_id()`.
- `WITH CHECK` — the variant **and** the `location_id` must both belong to it.

**The asymmetry is deliberate and it is the point.** `USING` alone would let a tenant write one of its
own variants against **another store's location** — a row that reads as ours, points at a warehouse
that is not, and silently corrupts that store's stock picture. Reads do not need the location clause
(a row is already reachable only through an owned variant); writes do.

`packages/db/src/schema.ts` is untouched: drizzle does not model policies, so migration/schema parity
is unaffected. `verify-rls-app.ts` needed no change either.

`packages/db/src/verify-rls.ts` — `inventory_levels` **removed from `REVIEWED_CHILD_TABLES`**. That
list means "un-RLS'd, but audited by hand"; this table is no longer un-RLS'd, so leaving it there
would have been a standing claim that the weaker guarantee is the one in force.

## Verification

- `packages/db/src/inventory-levels-rls.test.ts` — **6/6**, against real PostgreSQL.
  Cross-store `SELECT`/`UPDATE`/`DELETE` **by known row id** return or affect **zero rows**; same-store
  operations still pass; the cross-store-location INSERT is refused.
- **Four policy mutations, four reds** (applied directly to `tokophi_test`, then restored):
  | # | mutation | result |
  |---|---|---|
  | M1 | policy dropped | 2 failed |
  | M2 | `USING (true)` / `WITH CHECK (true)` | 5 failed |
  | M3 | `WITH CHECK` **without** the location clause | **1 failed** — exactly the test that justifies the asymmetry |
  | M4 | RLS disabled on the table | 5 failed |
  | — | restored | 6/6 green |
- `npm run verify-migrations -w @tokophi/db` → ✓ Journal waras · `npx tsc --noEmit -p packages/db` → 0
- Full repo `npx vitest run` → **126 files / 1041 tests**, all passing.

### ⚠️ A test error worth keeping

An RLS violation **aborts the transaction**, so a `finally { reset role }` fails with *"current
transaction is aborted"* — which masked the real error and reported a **working** policy as a failing
test. The suite uses a SAVEPOINT-based `refusal()` helper instead: `ROLLBACK TO SAVEPOINT` is accepted
inside an aborted transaction and restores the `SET LOCAL ROLE`. Any future refusal test on this
schema needs the same shape.

## Deployment note

**Migration 0100 was deliberately NOT applied to the shared dev DB while this branch was open** (repo
rule: don't migrate a branch's own migration into the shared container until close to merging). Until
it runs there, `npm run verify-rls` against the shared dev database is **red** — `inventory_levels`
was removed from `REVIEWED_CHILD_TABLES` while that database still lacks the policy. That is the
expected transient, not a regression. Production and `tokophi_test` get it from the normal migrate
step.
