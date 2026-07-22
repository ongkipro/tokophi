-- 0065 — RLS on `promo_pages`. Store-scoped (has `store_id`), so it takes the same tenant_isolation
-- policy as the 45 other store-scoped tables (migration 0012), and `verify-rls` — which derives its
-- set from the `store_id` column — will now REQUIRE this policy to exist. Keep it green.
--
-- The admin reads/writes this table under the `tokophi_app` role (withCurrentTenant/withTenant), so
-- the policy is what isolates one merchant's promo config from another's. The storefront reads it as
-- OWNER (Host-resolved tenant, like the rest of the catalog) and is unaffected.
alter table promo_pages enable row level security;

drop policy if exists tenant_isolation on promo_pages;
create policy tenant_isolation on promo_pages
  using (store_id = app_current_store_id())
  with check (store_id = app_current_store_id());
