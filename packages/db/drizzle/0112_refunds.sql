-- REFUND OBLIGATIONS — a paid prepaid order that is cancelled owes the buyer their money (Task 8.31).
--
-- Finance audit 2026-09-16, F12: `applyOrderStatusChange` on `batal`/`retur` restored stock, failed
-- only `menunggu` payments and clawed back the SELLER's sale — but a payment already `berhasil`
-- stayed `berhasil`. The buyer's money was held by the platform with no row saying it was owed back,
-- no screen, no action. This table is that row. It is written in the SAME transaction as the
-- claw-back, by `applyOrderStatusChange` and nothing else, and settled by hand from the Super Admin
-- Pencairan screen (transfer reference on `selesai`, reason on `gagal`) — the payout shape.
--
-- COD is never here: COD cash is collected at the door and a refused parcel is a `retur` that never
-- collected anything. One OPEN obligation per payment (partial unique index): cancelling twice, or a
-- replayed status change, cannot double the debt.
--
-- RLS like every store-scoped table (verify-rls derives the set from `store_id`), so a merchant's
-- order detail can read its own refund state under `tokophi_app`.
--
-- Idempotent (AGENTS.md): drizzle applies the whole pending batch in ONE transaction, so a single
-- "already exists" rolls back every migration behind it while printing "migrations applied
-- successfully".
do $$ begin
  create type "refund_status" as enum ('menunggu', 'diproses', 'selesai', 'gagal');
exception when duplicate_object then null; end $$;--> statement-breakpoint

create table if not exists "refunds" (
  "id" uuid primary key default gen_random_uuid() not null,
  "store_id" uuid not null references "stores"("id"),
  "order_id" uuid not null references "orders"("id"),
  "payment_id" uuid not null references "payments"("id"),
  "amount_idr" bigint default 0 not null,
  "status" "refund_status" default 'menunggu' not null,
  "reason" text,
  "note" text,
  "requested_at" timestamp with time zone default now() not null,
  "paid_at" timestamp with time zone
);--> statement-breakpoint

-- ONE open obligation per payment — the guarantee is the database's, never a check-then-write.
create unique index if not exists "refunds_one_open_per_payment"
  on "refunds" ("payment_id") where "status" in ('menunggu', 'diproses');--> statement-breakpoint
create index if not exists "refunds_store_idx" on "refunds" ("store_id");--> statement-breakpoint
create index if not exists "refunds_order_idx" on "refunds" ("order_id");--> statement-breakpoint

alter table "refunds" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "refunds";--> statement-breakpoint
create policy "tenant_isolation" on "refunds"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint

comment on table "refunds" is
  'Money owed back to a BUYER: written by applyOrderStatusChange when an order with a berhasil non-COD payment moves to batal/retur (Task 8.31). Settled manually by Super Admin (selesai = transferred, note = reference; gagal = refused, reason). One open row per payment.';--> statement-breakpoint
comment on column "refunds"."amount_idr" is
  'payments.amount_idr at cancellation — the pre-gateway-fee amount the buyer paid to us; the gateway''s admin fee is not ours to refund.';
