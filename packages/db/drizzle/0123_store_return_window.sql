-- BUYER-ACCOUNT-P1 (ADR 0016) — the store's own return window, shown to a buyer on an order that is on
-- its way or delivered. Ported from PR #424, where it took two migrations (`0119_store_return_window`,
-- 1–90 calendar days, then `0120_return_window_floor`, re-cut to 2–90 WORKING days). Neither ever
-- reached main, so they are folded here into the final shape.
--
-- Working days with a floor of 2: PP 80/2019 Pasal 69 ayat (1) (primary text read 2026-10-19) requires
-- "jangka waktu paling sedikit 2 (dua) hari kerja" for exchange or cancellation, counted from receipt; a
-- declared window below that would promise less than the regulation. NULL = the store has not declared
-- one, and the buyer is shown nothing (never a default promise made on the store's behalf).
-- Deliberately its own column: a promise to buyers, not a commission hold or a ledger setting.
--
-- Idempotent: drop-then-add for the check, `if not exists` for the column.
alter table "store_settings" add column if not exists "return_window_days" integer;--> statement-breakpoint
alter table "store_settings" drop constraint if exists "store_settings_return_window_check";--> statement-breakpoint
alter table "store_settings" add constraint "store_settings_return_window_check"
  check ("return_window_days" is null or ("return_window_days" between 2 and 90));--> statement-breakpoint
comment on column "store_settings"."return_window_days" is
  'Working days (hari kerja) after the buyer receives the goods during which the store accepts a return/exchange request, 2-90 (floor from PP 80/2019 Pasal 69(1)). NULL = not declared; buyers are shown nothing.';
