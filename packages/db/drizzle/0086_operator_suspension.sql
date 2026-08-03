-- Operator suspension is a SEPARATE FACT from the billing lifecycle.
--
-- Super Admin's "Tangguhkan" wrote `stores.status` and an audit row and did nothing else: the
-- merchant lockout is decided by `computeBilling()` (packages/lib/src/billing.ts), which read only
-- `comped` / `current_period_end` / `trial_ends_at` — never `status`. So a suspended merchant kept
-- a fully writable panel, and the nightly billing cron (`apps/admin/app/api/cron/billing`) rewrote
-- `status` back from the billing state within 24 hours. There was no working way to suspend a store.
--
-- The two cannot be one column. A store an operator suspended for abuse must stay suspended after it
-- pays, and a store suspended for non-payment must reactivate when it pays. `suspended_at` records
-- only the operator's act; billing keeps running underneath it and is unaffected.
--
-- Idempotent (see CLAUDE.md): drizzle applies the whole pending batch in ONE transaction, so a bare
-- `add column` that already exists rolls back every migration behind it, silently.
alter table "stores" add column if not exists "suspended_at" timestamp with time zone;
alter table "stores" add column if not exists "suspended_reason" text;
