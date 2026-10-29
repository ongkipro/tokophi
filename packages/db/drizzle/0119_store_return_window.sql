-- Task 10.22 (account spec §19, OD-9): the store's own return window, shown to a buyer on a finished order.
-- NULL = not declared = the buyer account says nothing about returns. Deliberately NOT affiliate_hold_days:
-- that is a commission hold, and changing a commission setting must never change a promise to a buyer.
alter table "store_settings" add column if not exists "return_window_days" integer;--> statement-breakpoint
do $$ begin
  alter table "store_settings" add constraint "store_settings_return_window_check"
    check ("return_window_days" is null or ("return_window_days" between 1 and 90));
exception when duplicate_object then null; end $$;--> statement-breakpoint
comment on column "store_settings"."return_window_days" is
  'Days after the buyer receives the goods during which the store accepts a return request (1-90). NULL = the store has not declared one; buyers are shown nothing.';
