-- The KiriminAja ORDER PREFIX is per ACCOUNT, and each environment is a different account: the
-- sandbox account's prefix is `5758`, the production account's is `PHI` (vendor dashboard, "Ubah
-- Informasi Production", 2026-09-17). Until now the prefix was ONE env var
-- (`KIRIMINAJA_ORDER_PREFIX`), so the Super Admin env switch (0111) changed the key and the host
-- but not the prefix: switching back to sandbox would have booked `PHI-…` against an account
-- registered as `5758`, which the vendor refuses ("Prefix … tidak sesuai dengan yang anda
-- daftarkan"). The prefix now lives beside the key it belongs to, per environment, and the seam
-- resolves it the same way it resolves the key: row first, env var second, code default last.
--
-- Backfill = the two measured account prefixes, only where nothing is stored yet, so an existing
-- deployment keeps booking exactly as it does today after the env var is removed.
-- Idempotent (AGENTS.md): drizzle applies the pending batch in ONE transaction.
alter table "shipping_aggregator" add column if not exists "sandbox_order_prefix" text;--> statement-breakpoint
alter table "shipping_aggregator" add column if not exists "production_order_prefix" text;--> statement-breakpoint
comment on column "shipping_aggregator"."sandbox_order_prefix" is
  'KiriminAja order_id prefix registered on the SANDBOX account (e.g. 5758). Row > KIRIMINAJA_ORDER_PREFIX env > TOKOPHI. Part of the 20-char order_id budget (Task 8.20).';--> statement-breakpoint
comment on column "shipping_aggregator"."production_order_prefix" is
  'KiriminAja order_id prefix registered on the PRODUCTION account (e.g. PHI). Row > KIRIMINAJA_ORDER_PREFIX env > TOKOPHI.';--> statement-breakpoint
update "shipping_aggregator" set "sandbox_order_prefix" = '5758' where "provider" = 'kiriminaja' and "sandbox_order_prefix" is null;--> statement-breakpoint
update "shipping_aggregator" set "production_order_prefix" = 'PHI' where "provider" = 'kiriminaja' and "production_order_prefix" is null;
