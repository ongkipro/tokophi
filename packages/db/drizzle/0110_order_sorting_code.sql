-- The courier's SORTING CODE on the order (KiriminAja UAT review, 2026-09-14).
--
-- KiriminAja: labels for SPX, ID Express, J&T Express and J&T Cargo MUST carry the sorting code
-- that arrives on the first webhook event, `processed_packages` (their example: `JOG-JOG1000-JKT2010`).
-- It is issued in production only; the sandbox answers `sorting_code: null` — measured on the UAT
-- parcels from the allow-listed production container. So the column and the label slot ship now,
-- empty, and fill on the first production booking.
--
-- ONE COLUMN, ONE WRITER. `apps/admin/lib/ka-tracking.ts` `syncOrderFromKa` writes it, from either
-- the verified tracking pull (`details.sorting_code`) or a webhook row whose `awb` equals the waybill
-- we verified for that order — never from a webhook body on its own (the receiver's hint-only rule).
-- It belongs to the AWB: when the waybill is cleared (a confirmed void) or replaced, it goes with it.
--
-- NULLABLE: NULL means "not issued yet". The label renders the slot as missing for the four couriers
-- that require it, rather than printing a guess.
-- No index: nothing looks an order up by its sorting code; it is carried to the label and printed.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
alter table "orders" add column if not exists "sorting_code" text;--> statement-breakpoint

comment on column "orders"."sorting_code" is
  'Courier sorting/routing code for this waybill (KiriminAja details.sorting_code / webhook processed_packages). Required on the label for spx, idx, jnt, jtcargo. Written only by syncOrderFromKa; cleared with the awb. NULL = not issued yet (sandbox always NULL).';
