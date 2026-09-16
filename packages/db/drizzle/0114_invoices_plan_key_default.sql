-- `invoices.plan_key` is the LAST place the abandoned plan tiers (pemula/bisnis/skala) were still
-- WRITTEN (Task 8.30 follow-up from 8.24, 2026-09-17). There is ONE plan since 2026-07 (AGENTS.md
-- "Billing & super-admin control"), so every creator had to invent a value for a NOT NULL column
-- with no default: `createSubscriptionInvoice` wrote `LEGACY_PLAN_KEY = 'bisnis'`, `comp-invoice.ts`
-- the same literal. Dropping the column is a destructive migration (it would run unattended on the
-- next Coolify build — the standing rule for `store_settings.payment_channels` and
-- `platform_payment_gateways.enabled`), so the column KEEPS its rows and gains a DEFAULT instead;
-- the application no longer names a tier when it writes an invoice. The enum stays: `stores.plan`
-- and `accounts.plan` still carry it (defaulted 'pemula', read by nothing that prices).
--
-- Idempotent: SET DEFAULT is repeatable; drizzle applies the pending batch in ONE transaction.
alter table "invoices" alter column "plan_key" set default 'bisnis';--> statement-breakpoint
comment on column "invoices"."plan_key" is
  'LEGACY — the single-plan product has no tiers. Defaulted to bisnis since 0114 so no creator has to invent a tier; never read for pricing. Kept (not dropped) because dropping is destructive.';
