-- ─────────────────────────────────────────────────────────────────────────────
-- 0058 — RLS on `stores`: close the blind spot that let two cross-tenant leaks ship.
--
-- WHAT WENT WRONG. `getStoreProfile` and `getBilling` both did
--     db.select({...}).from(stores).limit(1)
-- inside `withCurrentTenant`, trusting RLS to pick the tenant's row. RLS was never on this table, so
-- `limit(1)` returned an ARBITRARY store: Batik Nusantara's owner read Kopi Senja's shop name,
-- tagline, WhatsApp number and subscription countdown ("Aktif · 11h" — a stranger's). And because
-- `saveStoreProfile` writes with a CORRECT `where id = storeId`, pressing "Simpan Perubahan" without
-- editing anything would have renamed their own shop to the leaked one.
--
-- WHY THE GUARD MISSED IT. `verify-rls` derives the store-scoped set from the catalog by looking for
-- a `store_id` column. `stores` is keyed by `id` and has no `store_id` — so the one table that
-- IDENTIFIES the tenant was invisible to the check built to protect tenants. Both leaks shipped green.
--
-- The WHERE clauses are fixed in the same commit. This is the layer under them: a rule 12 authors must
-- remember is a rule that will be forgotten a 13th time. `id` is the tenant key here, so the policy
-- reads `id = app_current_store_id()` where every other table reads `store_id = …`.
--
-- WHY THIS IS SAFE FOR THE CROSS-TENANT READERS (checked, not assumed):
--   - No table in this database uses FORCE ROW LEVEL SECURITY (verified: 0 rows in pg_class), so the
--     table OWNER always bypasses RLS. Every legitimate cross-tenant reader runs as owner:
--       · lib/provision.ts   — slug uniqueness MUST see every store, or it would hand out duplicate
--                              slugs and two shops would collide on one subdomain.
--       · api/cron/billing   — bills every store; scoping it to one would silently stop billing.
--       · lib/auth.ts        — reads before a session exists (no GUC to scope by).
--       · apps/super-admin   — cross-tenant by definition.
--       · apps/storefront    — resolves the tenant FROM the Host header; that IS its scoping.
--     All use the bare module-level `db` (owner), never withTenant.
--   - Only the merchant admin drops to `tokophi_app` (withTenant/withCurrentTenant), which already
--     holds SELECT/INSERT/UPDATE/DELETE on stores — so this narrows what it SEES, nothing else.
--
-- `USING` + `WITH CHECK`, polcmd `*` — identical in shape to the 36 tables migration 0012 covers.
-- ─────────────────────────────────────────────────────────────────────────────

alter table stores enable row level security;

drop policy if exists tenant_isolation on stores;
create policy tenant_isolation on stores
  using (id = app_current_store_id())
  with check (id = app_current_store_id());
