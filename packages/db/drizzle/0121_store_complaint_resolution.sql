-- Task 10.25 (account spec OD-12, ACC-17): the store's own complaint-resolution period, in working days.
-- PP 80/2019 Pasal 27(2)(e) (official text, read 2026-10-19): a business's complaint service must cover, at least,
-- "jangka waktu penyelesaian pengaduan". NULL = the store has declared none; the buyer is shown nothing.
-- The 1-60 range is ours: the regulation sets no figure.
alter table "store_settings" add column if not exists "complaint_resolution_days" integer;--> statement-breakpoint
do $$ begin
  alter table "store_settings" add constraint "store_settings_complaint_days_check"
    check ("complaint_resolution_days" is null or ("complaint_resolution_days" between 1 and 60));
exception when duplicate_object then null; end $$;--> statement-breakpoint
comment on column "store_settings"."complaint_resolution_days" is
  'Working days (hari kerja) within which the store commits to resolve a buyer complaint, 1-60. NULL = not declared; buyers are shown nothing.';
