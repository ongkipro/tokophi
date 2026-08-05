-- TokoΦ — remove the 48 money rows whose `orders` parent does not exist.
--
-- ✅ ALREADY EXECUTED AGAINST PRODUCTION on 2026-08-05, with the owner's explicit approval.
--    Deleted 8 ledger_entries + 10 payments + 30 order_line_items. The 2 `kind='payout'` entries
--    (order_id NULL BY DESIGN) were left untouched, which is the whole point of the NULL split below.
--    Measured effect on what /saldo, the topbar chip and requestPayout read:
--        available  Rp21.842.562 → Rp21.032.562   (−Rp810.000, withdrawable money with no order behind it)
--        pending    Rp25.726.347 → Rp23.424.347   (−Rp2.302.000)
--    And the check that mattered: pending now EQUALS its own itemised "Dana dalam proses" list
--    (Rp23.424.347 = Rp23.424.347). Before, the page contradicted itself by Rp2.302.000.
--    The 48 rows were dumped as INSERT statements before deletion:
--        ~/Documents/work/notes/tokophi-orphans-backup-20260805.sql   (not in this repo — it is money data)
--
-- ⚠️ RE-RUNNING THIS IS A NO-OP, NOT A REPAIR. It deletes by "parent does not exist", and there are
--    no such rows left (`npm run verify-ledger -w @tokophi/db` proves it). Kept as the record of what
--    was run and as the tool if it ever recurs — but the FKs are validated and a dangling insert is
--    refused (23503), so it cannot recur through any application path.
--
-- ⚠️ THE LAST STATEMENT IS STILL `rollback`. It was changed to `commit` for the one deliberate run
--    above and changed straight back. Deleting production rows is the owner's call, every time.
--
-- ── WHY THIS IS NOT A DRIZZLE MIGRATION ────────────────────────────────────────────────────────
-- A file in `packages/db/drizzle/` is not a proposal, it is an execution: deploy = Coolify auto-build
-- on merge to `main`, and `migrate` applies the whole pending batch in ONE transaction, unattended.
-- Putting a `delete` there would destroy production data as a side effect of merging a pull request,
-- with no human at the keyboard and no chance to read the counts first. It would also drag every
-- other pending migration down with it if it failed, since the batch is one transaction.
--
-- There is a second reason, and it is the stronger one: **a migration here would be fixing nothing.**
-- The foreign keys already exist and are already VALIDATED —
--     payments_order_id_orders_id_fk, order_line_items_order_id_orders_id_fk,
--     ledger_entries_order_id_orders_id_fk   (all ON DELETE NO ACTION)
-- and `npm run verify-ledger -w @tokophi/db` proves Postgres refuses a dangling insert today. No
-- constraint is missing. These rows predate the constraint being enforced on THIS database: the
-- ledger notes still name `INV-4762 … INV-4788` while every surviving order is numbered `PHI-`, the
-- children sit at xmin 1069–1903 (the earliest transactions this database ever ran) and not one
-- surviving `orders` row is below xmin 6876. The only mechanisms that can produce this shape are
-- ones that switch referential integrity off — a `pg_restore --data-only --disable-triggers`, or a
-- session in `session_replication_role = 'replica'`. It is a one-time load artefact, not a leak, and
-- a one-time load artefact takes a one-time script.
--
-- ── WHAT IT IS WORTH ───────────────────────────────────────────────────────────────────────────
-- The merchant balance is DERIVED (`Σ amount_idr` by status) and NOTHING that sums it joins `orders`
-- — not `getBalance`, not the topbar chip, not super-admin's `getPlatformFloat`/`getStoreBalance`,
-- and not `requestPayout`'s "do you have enough?" test. Measured on production 2026-08-03:
--
--     available  Rp21.043.271  of which  Rp810.000    has no order behind it — and is WITHDRAWABLE
--     pending    Rp26.525.638  of which  Rp2.302.000  has no order behind it
--
-- The pending half is already visible to the merchant as a contradiction: `/saldo` prints
-- Rp26.525.638 held, and the itemised "Dana dalam proses" list underneath it — `getPendingFunds`,
-- which DOES join `orders` — can only account for Rp24.223.638 of it.
--
-- ⚠️ **DO NOT "FIX" THIS BY JOINING `orders` IN THE BALANCE QUERIES.** A `payout` entry has
-- `order_id IS NULL` by design. An inner join drops every withdrawal ever made, and available goes
-- Rp21.043.271 → Rp43.733.271 — it hands back the Rp23.500.000 already paid out. The reads are
-- correct; the rows are not. `packages/db/src/verify-ledger.test.ts` pins both halves.
--
-- ── ORDER OF DELETION ──────────────────────────────────────────────────────────────────────────
-- `ledger_entries.payment_id` → `payments.id`, and all 8 orphan ledger rows point at orphan
-- payments. So: ledger first, then payments, then line items. Any other order fails on an FK.
--
-- ── RUNNING IT ─────────────────────────────────────────────────────────────────────────────────
--   1. Dry run (this file as-is — prints the counts, then rolls back):
--        ssh -i ~/.ssh/tokophi_dev root@45.77.33.112 \
--          'docker exec -i $(docker ps --format "{{.Names}}" | grep -m1 "^postgres-") \
--             psql -U tokophi -d tokophi' < ops/tokophi-orphan-cleanup.sql
--      (resolve the container BY PREFIX — the hash suffix changes on every deploy)
--   2. Read the BEFORE/AFTER blocks. `dangling` must be 0 after, `null_parent` must be UNCHANGED
--      (2 payout entries + 4 conversations — those are legitimate and must survive).
--   3. Only then, change the final ROLLBACK to COMMIT and run it again.
--   4. Confirm: npm run verify-ledger -w @tokophi/db   (against DATABASE_URL=production)

\set ON_ERROR_STOP on
\pset pager off

begin;

-- ── BEFORE ──────────────────────────────────────────────────────────────────────────────────────
-- `order_id IS NULL` is counted in its own column and never touched. `not exists (select 1 from
-- orders where id = child.order_id)` is TRUE for a NULL, so a predicate written the obvious way
-- deletes every payout entry in the book. That is the whole reason both columns are printed.
\echo '── BEFORE ──'
select 'ledger_entries' as tbl,
       count(*) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)) as dangling,
       count(*) filter (where order_id is null) as null_parent,
       coalesce(sum(amount_idr) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)), 0) as idr
  from ledger_entries x
union all
select 'payments',
       count(*) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)),
       count(*) filter (where order_id is null),
       coalesce(sum(amount_idr) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)), 0)
  from payments x
union all
select 'order_line_items',
       count(*) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)),
       count(*) filter (where order_id is null),
       coalesce(sum(total_idr) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)), 0)
  from order_line_items x;

-- ── BLAST-RADIUS GUARD ──────────────────────────────────────────────────────────────────────────
-- The measured population is 8 + 10 + 30 = 48. If this file is ever run against a database where the
-- `orders` table has been emptied or half-restored, the same WHERE clause matches EVERYTHING, and a
-- cleanup script becomes the outage. Abort well below anything that could be a real incident.
do $$
declare n integer;
begin
  select (select count(*) from ledger_entries   x where x.order_id is not null and not exists (select 1 from orders o where o.id = x.order_id))
       + (select count(*) from payments         x where x.order_id is not null and not exists (select 1 from orders o where o.id = x.order_id))
       + (select count(*) from order_line_items x where x.order_id is not null and not exists (select 1 from orders o where o.id = x.order_id))
    into n;
  if n > 100 then
    raise exception 'REFUSING: % orphan rows is far past the 48 this was written for — investigate before deleting anything', n;
  end if;
  raise notice 'orphan rows to delete: %', n;
end $$;

-- ── DELETE ──────────────────────────────────────────────────────────────────────────────────────
-- Ledger first: its `payment_id` references the payments deleted next.
delete from ledger_entries x
 where x.order_id is not null
   and not exists (select 1 from orders o where o.id = x.order_id);

delete from payments x
 where x.order_id is not null
   and not exists (select 1 from orders o where o.id = x.order_id);

delete from order_line_items x
 where x.order_id is not null
   and not exists (select 1 from orders o where o.id = x.order_id);

-- ── AFTER ───────────────────────────────────────────────────────────────────────────────────────
-- `dangling` = 0, `null_parent` unchanged, and the balance every screen renders now equals the
-- balance with orphans excluded — i.e. the headline and its itemisation finally agree.
\echo '── AFTER ──'
select 'ledger_entries' as tbl,
       count(*) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)) as dangling,
       count(*) filter (where order_id is null) as null_parent
  from ledger_entries x
union all
select 'payments',
       count(*) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)),
       count(*) filter (where order_id is null)
  from payments x
union all
select 'order_line_items',
       count(*) filter (where order_id is not null and not exists (select 1 from orders o where o.id = x.order_id)),
       count(*) filter (where order_id is null)
  from order_line_items x;

\echo '── BALANCE AFTER (what /saldo, the topbar chip and requestPayout will read) ──'
select store_id,
       coalesce(sum(amount_idr) filter (where status = 'available'), 0) as available,
       coalesce(sum(amount_idr) filter (where status = 'pending'),   0) as pending,
       coalesce(-sum(amount_idr) filter (where kind = 'payout'),     0) as withdrawn
  from ledger_entries
 group by store_id
 order by 1;

\echo '── itemised "Dana dalam proses" — must now EQUAL the pending figure above ──'
select coalesce(sum(l.amount_idr), 0) as itemised_pending
  from ledger_entries l
  join orders o on o.id = l.order_id
 where l.status = 'pending' and l.kind = 'sale';

-- ⚠️ CHANGE THIS TO `commit;` ONLY AFTER READING THE BLOCKS ABOVE.
rollback;
