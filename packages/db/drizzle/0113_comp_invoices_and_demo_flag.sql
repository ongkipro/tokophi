-- Two facts the platform KPIs could not see (finance audit 2026-09-16, F3 + F8; Tasks 8.26 / 8.27).
--
-- 1. A COMP IS NOT REVENUE. "Gratis 1 bulan" (`compStore`) only moved `stores.current_period_end`,
--    so every downstream reader — MRR, ARPU, "Pelanggan berbayar" — saw an active period and
--    counted it as a paying customer. Measured on production: 12 stores "active" on 26 comps,
--    MRR ≈ Rp600.000, real paying merchants 0. A comp now ALSO writes an `invoices` row with
--    `kind = 'comp'`, amount 0, tax 0, status `dibayar`, `cycle = 'comp'`, `period_months` — so the
--    period is backed by a row that says what backed it. `invoices.kind` is free text (it already
--    carries 'subscription' and NULL for seeded legacy rows); 'comp' is documented here and in
--    schema.ts, not enforced by an enum, because an enum ADD VALUE has no IF NOT EXISTS form and
--    aborts the whole pending batch (AGENTS.md).
--    Backfill: one comp row per historical "Gratis N bulan diberikan" audit line, keyed on its
--    timestamp — idempotent via a partial unique index on (store_id, issued_at) where kind = 'comp'.
--
-- 2. THE DEMO STORE IS NOT A CUSTOMER. `batiknusantara` (toko.tokophi.com) owns 220 of 225
--    production orders, every ledger entry, both payouts and the five "paid" seeded invoices, and
--    every platform money tile summed it in. `stores.is_demo` marks it; the platform KPIs exclude
--    it; the store itself keeps working. Flag, not purge (owner decision under the 2026-09-17 goal):
--    a purge is destructive and the seed would need a guard against re-creating it.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
alter table "stores" add column if not exists "is_demo" boolean not null default false;--> statement-breakpoint
comment on column "stores"."is_demo" is
  'Seeded demo store (toko.tokophi.com). Excluded from every platform money KPI (MRR, revenue, float, GMV, courier cost); still served and listed with a Demo badge. 0113.';--> statement-breakpoint
update "stores" set "is_demo" = true where "slug" = 'batiknusantara' and "is_demo" = false;--> statement-breakpoint

comment on column "invoices"."kind" is
  'subscription = a bill the merchant pays; comp = a period the platform granted for free (amount 0, status dibayar, cycle comp) — written by compStore and backfilled by 0113 so MRR can tell a comp from a payment; NULL = seeded legacy rows.';--> statement-breakpoint
create unique index if not exists "invoices_one_comp_per_grant" on "invoices" ("store_id", "issued_at") where "kind" = 'comp';--> statement-breakpoint

-- Historical comps: every "Gratis N bulan diberikan" audit line becomes one comp invoice, stamped
-- with the line's own timestamp. `number` must be unique: COMP- + the first 12 hex chars of the
-- activity id. Re-running inserts nothing (the partial unique index + NOT EXISTS).
insert into "invoices" ("number", "account_id", "store_id", "plan_key", "amount_idr", "tax_idr", "status", "kind", "cycle", "period_months", "issued_at", "paid_at")
select 'COMP-' || left(replace(a.id::text, '-', ''), 12),
       s.account_id, s.id, 'bisnis', 0, 0, 'dibayar', 'comp', 'comp',
       coalesce(nullif(substring(a.text from 'Gratis (\d+) bulan'), '')::int, 1),
       a.ts, a.ts
  from "platform_activity" a
  join "stores" s on s.id = a.store_id
 where a.text like 'Gratis % bulan diberikan%'
   and not exists (select 1 from "invoices" i where i.store_id = s.id and i.kind = 'comp' and i.issued_at = a.ts)
on conflict do nothing;
