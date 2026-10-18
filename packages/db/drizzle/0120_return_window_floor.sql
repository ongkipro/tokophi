-- Task 10.24: the return window is in WORKING DAYS and has a floor of 2. Primary text of PP 80/2019
-- Pasal 69 ayat (1) (read 2026-10-19): merchants and e-commerce operators must give "jangka waktu paling
-- sedikit 2 (dua) hari kerja" for exchange or cancellation, counted from receipt. 0119 allowed 1-90; a
-- declared window below the floor would promise less than the regulation. The column stays nullable (not
-- declared). No row can hold 0-1 yet: 0119 exists only on branch databases.
alter table "store_settings" drop constraint if exists "store_settings_return_window_check";--> statement-breakpoint
alter table "store_settings" add constraint "store_settings_return_window_check"
  check ("return_window_days" is null or ("return_window_days" between 2 and 90));--> statement-breakpoint
comment on column "store_settings"."return_window_days" is
  'Working days (hari kerja) after the buyer receives the goods during which the store accepts a return/exchange request, 2-90 (floor from PP 80/2019 Pasal 69(1)). NULL = not declared; buyers are shown nothing.';
