-- TokoΦ DB parity/integrity screen — READ-ONLY. First run: 2026-08-12 (see
-- specs/docs/tasks/2026-08-12-n41-seed-drift-parity.md for that run's results and verdicts).
--
-- Run against BOTH sides and compare:
--   prod: ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 \
--           'docker exec -i $(docker ps --format "{{.Names}}" | grep -m1 "^postgres-") \
--            psql -U tokophi -d tokophi' < ops/tokophi-db-parity-screen.sql
--   dev:  docker exec -i tokophi-db psql -U tokophi -d tokophi < ops/tokophi-db-parity-screen.sql
--
-- Guards: the whole session is read-only and time-bounded. Any statement that tries to write
-- fails with "cannot execute ... in a read-only transaction" instead of committing.
-- What this deliberately does NOT do: verify-ledger's rollback-write FK probe (owner-gated,
-- see 2026-08-05-database-screening.md), migrations, VACUUM/REINDEX, or any repair.
SET default_transaction_read_only = on;
SET statement_timeout = '30s';

-- ── 1 · Runtime identity ────────────────────────────────────────────────────
select version();
select pg_size_pretty(pg_database_size(current_database())) as db_size;
select count(*) as migrations_applied, max(created_at) as newest_stamp
  from drizzle.__drizzle_migrations;
-- Compare BOTH count and the stamp list against packages/db/drizzle/meta/_journal.json.
-- Count stamps from the TARGET DB, never from the journal alone (AGENTS.md).
select created_at from drizzle.__drizzle_migrations order by created_at;

-- ── 2 · Schema surface (diff these listings between the two sides) ──────────
select relname||':rls='||relrowsecurity as table_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and relkind = 'r' order by relname;
select table_name||'.'||column_name||':'||data_type||':'||is_nullable as col
  from information_schema.columns where table_schema = 'public'
 order by table_name, column_name;
select tablename||':'||policyname||':'||cmd as policy from pg_policies
 where schemaname = 'public' order by tablename, policyname;
select t.typname||':'||string_agg(e.enumlabel, ',' order by e.enumsortorder) as enum
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public' group by t.typname order by t.typname;
select table_name||':'||string_agg(privilege_type, ',' order by privilege_type) as app_grants
  from information_schema.role_table_grants
 where grantee = 'tokophi_app' and table_schema = 'public'
 group by table_name order by table_name;

-- ── 3 · Tenant isolation aggregates (every row must be 0) ───────────────────
select 'li_cross_store' as chk, count(*) from order_line_items li
  join orders o on o.id = li.order_id join product_variants v on v.id = li.variant_id
  join products p on p.id = v.product_id where p.store_id <> o.store_id
union all
select 'collection_products_cross_store', count(*) from collection_products cp
  join collections c on c.id = cp.collection_id join products p on p.id = cp.product_id
 where c.store_id <> p.store_id
union all
select 'payments_store_mismatch', count(*) from payments pay
  join orders o on o.id = pay.order_id where pay.store_id <> o.store_id
union all
select 'ledger_store_mismatch', count(*) from ledger_entries le
  join orders o on o.id = le.order_id where le.store_id <> o.store_id
union all
select 'inventory_cross_store', count(*) from inventory_levels il
  join locations l on l.id = il.location_id join product_variants v on v.id = il.variant_id
  join products p on p.id = v.product_id where l.store_id <> p.store_id
union all
select 'orders_customer_cross_store', count(*) from orders o
  join customers c on c.id = o.customer_id where c.store_id <> o.store_id;

-- ── 4 · Commerce integrity (0 expected everywhere; totals are context) ──────
select 'dup_invoice_numbers' as chk, count(*) from (select number from invoices group by number having count(*) > 1) x
union all select 'dup_order_numbers', count(*) from (select number from orders group by number having count(*) > 1) x
union all select 'negative_available', count(*) from inventory_levels where available < 0
union all select 'orders_no_lines', count(*) from orders o where not exists (select 1 from order_line_items li where li.order_id = o.id)
union all select 'subtotal_mismatch', count(*) from (
  select o.id from orders o join order_line_items li on li.order_id = o.id
  group by o.id, o.subtotal_idr having sum(li.total_idr) <> o.subtotal_idr) x
union all select 'total_arithmetic_mismatch', count(*) from orders
  where total_idr <> subtotal_idr - discount_idr + shipping_idr + tax_idr
union all select 'ledger_sale_no_order', count(*) from ledger_entries where kind = 'sale' and order_id is null
union all select 'dibayar_without_success_payment', count(*) from orders o
  where o.financial_status = 'dibayar'
    and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'berhasil')
union all select 'success_payment_order_pending', count(*) from payments p
  join orders o on o.id = p.order_id where p.status = 'berhasil' and o.financial_status = 'pending'
union all select 'orders_total', count(*) from orders
union all select 'payments_total', count(*) from payments
union all select 'ledger_total', count(*) from ledger_entries;

-- ── 5 · Seed/config drift (findings, never automatic repairs) ───────────────
-- The seed is not a migration: differences here are epochs, decisions, or drift — read
-- specs/docs/tasks/2026-08-12-n41-seed-drift-parity.md before "fixing" any of them.
select s.slug, count(ssm.*) as shipping_method_rows
  from stores s left join store_shipping_methods ssm on ssm.store_id = s.id
 group by s.slug order by s.slug;
select s.slug, count(r.*) as reviews, count(*) filter (where r.product_id is null) as product_id_null
  from reviews r left join stores s on s.id = r.store_id group by s.slug order by s.slug;
select count(*) as channels, count(*) filter (where enabled) as enabled from platform_payment_channels;
select release_on, min_payout_idr, auto_approve from platform_payout;
select courier, enabled, (services::jsonb -> 0) ? 'codAllowed' as new_dialect,
       jsonb_array_length(services::jsonb) as n_services
  from platform_couriers order by courier;
select enabled, max_amount_idr, jsonb_array_length(allowed_provinces::jsonb) as provinces
  from platform_cod;

-- ── 6 · Capacity ────────────────────────────────────────────────────────────
select relname, pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and relkind = 'r'
 order by pg_total_relation_size(c.oid) desc limit 10;
select relname, n_live_tup, n_dead_tup from pg_stat_user_tables
 where n_dead_tup > 500 order by n_dead_tup desc limit 10;
-- Backups + disk are host-level, not SQL: on the VPS check `df -h /` and the newest dump in the
-- backup sidecar's volume (container `backup-*`; ~6-hourly, local-only until DR-1 lands).
