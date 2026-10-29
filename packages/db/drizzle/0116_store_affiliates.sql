-- STORE AFFILIATE PROGRAMME — the data half (Task 9.1, specs/AFFILIATE_SPEC.md, owner 2026-10-11).
--
-- A merchant runs its own programme: affiliates apply on the storefront, the merchant approves them,
-- an order carrying their code (typed, or a captured `?ref=`) gets ONE commission row, frozen at
-- order time. The merchant pays the affiliate OUTSIDE TokoΦ and marks the row `dibayar`; nothing here
-- touches `ledger_entries` or `payouts` — the platform never holds affiliate money.
--
-- "Siap dibayar" is DERIVED (status = 'pending' and eligible_at <= now()), not a status, so no cron
-- has to promote rows and no row can sit in a state the clock already left.
--
-- Rates are integer BASIS POINTS (1000 = 10%): a commission is never computed in floating point.
-- Additive only; programme OFF by default, so no existing store changes behaviour on deploy.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing success.
do $$ begin
  create type "affiliate_status" as enum ('menunggu', 'aktif', 'ditolak', 'nonaktif');
exception when duplicate_object then null; end $$;--> statement-breakpoint
do $$ begin
  create type "affiliate_commission_status" as enum ('pending', 'dibayar', 'batal');
exception when duplicate_object then null; end $$;--> statement-breakpoint

alter table "store_settings" add column if not exists "affiliate_enabled" boolean default false not null;--> statement-breakpoint
alter table "store_settings" add column if not exists "affiliate_rate_bps" integer default 1000 not null;--> statement-breakpoint
alter table "store_settings" add column if not exists "affiliate_hold_days" integer default 3 not null;--> statement-breakpoint
alter table "products" add column if not exists "affiliate_rate_bps" integer;--> statement-breakpoint

create table if not exists "affiliates" (
  "id" uuid primary key default gen_random_uuid() not null,
  "store_id" uuid not null references "stores"("id"),
  "code" text not null,
  "name" text not null,
  "phone" text not null,
  "email" text,
  "bank_name" text,
  "bank_account" text,
  "bank_holder" text,
  "status" "affiliate_status" default 'menunggu' not null,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "approved_at" timestamp with time zone,
  constraint "affiliates_store_id_code_unique" unique ("store_id", "code")
);--> statement-breakpoint
create index if not exists "affiliates_store_status_idx" on "affiliates" ("store_id", "status");--> statement-breakpoint

create table if not exists "affiliate_commissions" (
  "id" uuid primary key default gen_random_uuid() not null,
  "store_id" uuid not null references "stores"("id"),
  "affiliate_id" uuid not null references "affiliates"("id"),
  "order_id" uuid not null references "orders"("id"),
  "source" text not null,
  "base_idr" bigint default 0 not null,
  "commission_idr" bigint default 0 not null,
  "rate_note" text,
  "status" "affiliate_commission_status" default 'pending' not null,
  "eligible_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "paid_note" text,
  "created_at" timestamp with time zone default now() not null,
  constraint "affiliate_commissions_order_id_unique" unique ("order_id")
);--> statement-breakpoint
create index if not exists "affiliate_commissions_store_idx" on "affiliate_commissions" ("store_id", "status");--> statement-breakpoint

alter table "affiliates" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "affiliates";--> statement-breakpoint
create policy "tenant_isolation" on "affiliates"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
alter table "affiliate_commissions" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "affiliate_commissions";--> statement-breakpoint
create policy "tenant_isolation" on "affiliate_commissions"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint

comment on table "affiliate_commissions" is
  'One commission per attributed order (Task 9.2), frozen at order time. pending → dibayar (merchant marked it paid after paying outside TokoΦ) or batal (order batal/retur). Payable = pending and eligible_at <= now(); eligible_at is set when the order reaches selesai (+ store_settings.affiliate_hold_days).';--> statement-breakpoint
comment on column "products"."affiliate_rate_bps" is
  'Affiliate commission override in basis points (1000 = 10%). NULL = store_settings.affiliate_rate_bps; 0 = no commission on this product.';
