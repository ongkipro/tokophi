-- 0068 — RLS on landing_pages. Store-scoped (has store_id) → same tenant_isolation policy as the rest
-- (migration 0012); verify-rls will now REQUIRE it. Admin reads/writes under tokophi_app; storefront
-- reads as OWNER (Host-resolved tenant), unaffected.
alter table landing_pages enable row level security;

drop policy if exists tenant_isolation on landing_pages;
create policy tenant_isolation on landing_pages
  using (store_id = app_current_store_id())
  with check (store_id = app_current_store_id());
