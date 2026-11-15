-- SHIP-MENGANTAR (owner 2026-11-05): a second shipping provider beside KiriminAja, switchable from the
-- Super Admin. Design: specs/docs/tasks/2026-11-05-mengantar-integration-analysis.md §3–5; decisions:
-- specs/docs/tasks/2026-11-05-shipping-mengantar-decisions.md.
--
-- What this adds, and why each piece is shaped the way it is:
--   1. `mengantar_areas` — Mengantar's own area catalogue (kelurahan grain, 24-hex `_id`), imported from
--      99ribu's harvest by packages/db/scripts/load-mengantar-areas.mjs. Reference data, NOT store-scoped
--      (no store_id → no RLS), the same class as kiriminaja_areas / kelurahan.
--   2. Bridge columns (nullable, NO foreign keys): a NULL means "not matched", never a guess. FKs are left
--      out on purpose — a refreshed dataset may drop an id an old order still names.
--   3. `orders.shipping_provider` — the provider a shipment was BOOKED with. Tracking, cancel, label and
--      payment follow the ORDER's stamp, never the current switch, so flipping the switch mid-flight
--      cannot strand a KiriminAja parcel. NULL = legacy = KiriminAja. `mg_*` mirror the `ka_*` columns.
--   4. `shipping_provider_config` — one row: which provider QUOTES new checkouts (default kiriminaja =
--      today's behaviour), and the Mengantar PARTNER credential per environment (partner id + AES-GCM
--      partner secret, same helper as 0111). `text` + CHECK instead of a new enum value: `ALTER TYPE …
--      ADD VALUE` cannot be used inside the transaction that adds it, and drizzle applies a pending
--      batch in ONE transaction.
--   5. `store_mengantar_accounts` — the PARTNER model (owner 2026-11-05, "menggantikan mengantar personal
--      sebelumnya"): every store gets ITS OWN Mengantar seller account, registered by TokoΦ through the
--      Partner API with the owner's TokoΦ email. The seller's Public-API key is sealed here (AES-GCM,
--      scope bound to store + env + seller + key version); the seller's wallet pays its own postage.
--      Store-scoped → RLS. Design: Mengantar partner docs (private, kept off-repo) + the decisions doc.
--   6. `orders.mg_env` / `orders.mg_seller_id` — WHICH seller account (and environment) booked a
--      shipment. Tracking / cancel / pay-unpaid open that account's key, never "the store's current one".
--   7. `order_seller_entitlements` gains `shipping_pass_through_idr`: on a Mengantar-stamped order the
--      buyer's shipping is the seller's money (the seller's own wallet paid the courier — owner O3).
--
-- REWRITTEN IN PLACE 2026-11-05 (before merge; 0116 was never on main nor on the shared DB): the
-- platform-key columns `mengantar_key_enc` / `mengantar_webhook_secret_enc` / `mengantar_tested_at` and
-- `store_settings.mengantar_pickup_address_id` are GONE — the key and pickup address are per seller now.
--
-- Idempotent (AGENTS.md / specs/docs/rules/migrations.md): every statement can re-run.
-- ⚠️ Numbering: written as 0116 after origin/main's 0115; PR #424 also claims 0116+. Whoever merges
-- second RENUMBERS AND RE-STAMPS. Never applied to the shared `tokophi` dev DB before merge.

create table if not exists "mengantar_areas" (
  "id" text primary key,
  "province" text not null,
  "city" text not null,
  "district" text not null,
  "subdistrict" text not null,
  "postal_code" text not null default '',
  "dataset_version" text not null,
  constraint "mengantar_areas_id_check" check ("id" ~ '^[0-9a-f]{24}$'),
  constraint "mengantar_areas_postal_check" check ("postal_code" = '' or "postal_code" ~ '^[0-9]{5}$')
);--> statement-breakpoint
create index if not exists "mengantar_areas_postal_idx" on "mengantar_areas" ("postal_code");--> statement-breakpoint
create index if not exists "mengantar_areas_district_idx" on "mengantar_areas" ("district", "city");--> statement-breakpoint
comment on table "mengantar_areas" is
  'Mengantar area catalogue (kelurahan grain), imported from 99ribu data/shipping/mengantar-areas.json.gz by load-mengantar-areas.mjs. Reference data, not store-scoped.';--> statement-breakpoint
comment on column "mengantar_areas"."id" is 'Mengantar area _id (24-hex ObjectId) — the origin_id / destination_id / customerAddressDataId the API takes.';--> statement-breakpoint
comment on column "mengantar_areas"."dataset_version" is 'harvested_at of the imported 99ribu artefact, so a refresh can tell old rows from new.';--> statement-breakpoint

alter table "kelurahan" add column if not exists "mengantar_area_id" text;--> statement-breakpoint
comment on column "kelurahan"."mengantar_area_id" is
  'Mengantar area _id for this kelurahan. Written by load-mengantar-areas.mjs ONLY on a unique (name, postcode) or (name, district) match; NULL = not matched (resolved live, never guessed).';--> statement-breakpoint
alter table "kiriminaja_areas" add column if not exists "mengantar_area_id" text;--> statement-breakpoint
comment on column "kiriminaja_areas"."mengantar_area_id" is
  'A deterministic representative Mengantar kelurahan _id for this kecamatan — used to QUOTE when the shopper picked no kelurahan (analysis §3.5 option a). Booking uses the kelurahan when known.';--> statement-breakpoint

alter table "store_settings" add column if not exists "sender_mengantar_area_id" text;--> statement-breakpoint
comment on column "store_settings"."sender_mengantar_area_id" is
  'Seller pickup origin as a Mengantar area _id (bridge of sender_kecamatan_id). The ONLY origin a Mengantar quote uses — never the client.';--> statement-breakpoint

alter table "orders" add column if not exists "ship_mengantar_area_id" text;--> statement-breakpoint
comment on column "orders"."ship_mengantar_area_id" is 'Destination Mengantar area _id resolved at checkout (Mengantar orders only).';--> statement-breakpoint
alter table "orders" add column if not exists "shipping_provider" text;--> statement-breakpoint
do $$ begin
  alter table "orders" add constraint "orders_shipping_provider_check" check ("shipping_provider" is null or "shipping_provider" in ('kiriminaja', 'mengantar'));
exception when duplicate_object then null; end $$;--> statement-breakpoint
comment on column "orders"."shipping_provider" is
  'Provider the order was QUOTED/BOOKED with. NULL = legacy = kiriminaja. Tracking, cancel, label and payment follow this stamp, never the current switch.';--> statement-breakpoint
alter table "orders" add column if not exists "mg_order_id" text;--> statement-breakpoint
comment on column "orders"."mg_order_id" is 'Mengantar shipment _id (POST /order data[]._id) — the id DELETE /order cancels by.';--> statement-breakpoint
alter table "orders" add column if not exists "mg_order_code" text;--> statement-breakpoint
comment on column "orders"."mg_order_code" is 'Mengantar ORDER_ID — used to poll GET /order?order_id= while cnote_no is still null.';--> statement-breakpoint
alter table "orders" add column if not exists "mg_batch_id" text;--> statement-breakpoint
comment on column "orders"."mg_batch_id" is 'Mengantar batch_id — needed by POST /order/pay-unpaid when the wallet was short at booking.';--> statement-breakpoint
alter table "orders" add column if not exists "mg_is_paid" boolean;--> statement-breakpoint
comment on column "orders"."mg_is_paid" is 'Mengantar isPaid at booking. false = booked but unpaid (the SELLER''s Mengantar wallet was short): no waybill until the seller pays (Bayar ongkir). null = payment requested, outcome not confirmed.';--> statement-breakpoint
alter table "orders" add column if not exists "mg_courier" text;--> statement-breakpoint
comment on column "orders"."mg_courier" is 'Mengantar booking courier name (shipmentName of the estimate key) — DELETE /order and pay-unpaid take it.';--> statement-breakpoint

alter table "orders" add column if not exists "mg_env" text;--> statement-breakpoint
comment on column "orders"."mg_env" is 'Mengantar environment (sandbox|production) the shipment was booked in. Tracking/cancel refuse when it differs from MENGANTAR_ENV.';--> statement-breakpoint
alter table "orders" add column if not exists "mg_seller_id" text;--> statement-breakpoint
comment on column "orders"."mg_seller_id" is 'Mengantar Partner sellerId whose key booked this shipment. Tracking/cancel/pay use THAT account; a store whose account changed since flags the order instead of using the new key.';--> statement-breakpoint

create table if not exists "shipping_provider_config" (
  "id" smallint primary key default 1,
  "active_provider" text not null default 'kiriminaja',
  "mengantar_sandbox_partner_id" text,
  "mengantar_sandbox_partner_secret_enc" text,
  "mengantar_production_partner_id" text,
  "mengantar_production_partner_secret_enc" text,
  "updated_at" timestamp with time zone not null default now(),
  constraint "shipping_provider_config_singleton" check ("id" = 1),
  constraint "shipping_provider_config_provider_check" check ("active_provider" in ('kiriminaja', 'mengantar'))
);--> statement-breakpoint
insert into "shipping_provider_config" ("id") values (1) on conflict do nothing;--> statement-breakpoint
comment on table "shipping_provider_config" is
  'Platform shipping switch (one row). active_provider decides who QUOTES new checkouts for stores that have a connected Mengantar account (others fall back to kiriminaja); existing orders keep their own shipping_provider stamp. Changed by an owner-rank Super Admin action with a reason, audit-logged.';--> statement-breakpoint
comment on column "shipping_provider_config"."mengantar_sandbox_partner_secret_enc" is
  'Mengantar Partner Secret for the sandbox, AES-GCM (scope provider:mengantar:partner:sandbox). Row > MENGANTAR_PARTNER_SECRET env. Swappable (owner O1: the GeraiExpress partner today, maybe our own later).';--> statement-breakpoint
comment on column "shipping_provider_config"."mengantar_production_partner_secret_enc" is
  'Mengantar Partner Secret for production, AES-GCM (scope provider:mengantar:partner:production). Row > MENGANTAR_PARTNER_SECRET env.';--> statement-breakpoint

create table if not exists "store_mengantar_accounts" (
  "store_id" uuid not null references "stores"("id"),
  "env" text not null,
  "external_user_id" text not null,
  "partner_id" text,
  "seller_id" text,
  "state" text not null default 'pending',
  "owner_email" text,
  "owner_name" text,
  "owner_phone" text,
  "consent_source" text,
  "consent_by" uuid,
  "consented_at" timestamp with time zone,
  "api_key_enc" text,
  "key_hint" text,
  "key_version" integer not null default 0,
  "pickup_address_id" text,
  "attempts" integer not null default 0,
  "last_error_code" text,
  "last_error" text,
  "retry_after_at" timestamp with time zone,
  "connected_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "store_mengantar_accounts_pk" primary key ("store_id", "env"),
  constraint "sma_env_check" check ("env" in ('sandbox', 'production')),
  constraint "sma_state_check" check ("state" in ('pending', 'registering', 'connected', 'email_taken', 'failed', 'blocked', 'rotating')),
  constraint "sma_ext_check" check (
    ("env" = 'production' and "external_user_id" = 'tokophi:store:' || "store_id"::text)
    or ("env" = 'sandbox' and "external_user_id" = 'tokophi:sandbox:store:' || "store_id"::text)),
  constraint "sma_seller_check" check ("seller_id" is null or "seller_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint "sma_connected_check" check ("state" <> 'connected' or ("seller_id" is not null and "api_key_enc" is not null))
);--> statement-breakpoint
create unique index if not exists "sma_seller_uniq" on "store_mengantar_accounts" ("env", "seller_id") where "seller_id" is not null;--> statement-breakpoint
create unique index if not exists "sma_ext_uniq" on "store_mengantar_accounts" ("env", "external_user_id");--> statement-breakpoint
create index if not exists "sma_retry_idx" on "store_mengantar_accounts" ("env", "state") where "state" in ('pending', 'registering');--> statement-breakpoint
alter table "store_mengantar_accounts" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "store_mengantar_accounts";--> statement-breakpoint
create policy "tenant_isolation" on "store_mengantar_accounts" using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
comment on table "store_mengantar_accounts" is
  'One Mengantar SELLER account per (store, env), registered by TokoΦ via the Partner API with the store owner''s TokoΦ email (owner O7/O10: never a pasted key). Its wallet pays the store''s postage; its key is sealed in api_key_enc. state: pending (queued/retry) · registering (call in flight or outcome unknown → reconciled via sellers/list) · connected · email_taken (409, store stays on KiriminAja) · failed (input refused) · blocked (configuration/provider refusal) · rotating (regenerate fence).';--> statement-breakpoint
comment on column "store_mengantar_accounts"."api_key_enc" is
  'Seller Public-API key, AES-GCM, scope mengantar:<store_id>:<env>:<seller_id>:v<key_version>. Never shown; key_hint is the last 4 chars only.';--> statement-breakpoint
comment on column "store_mengantar_accounts"."seller_id" is
  'Partner sellerId — written only after sellers/list proved it belongs to this row''s external_user_id (GeraiExpress P0-1: one partner, many tenants).';--> statement-breakpoint
comment on column "store_mengantar_accounts"."partner_id" is 'Partner id that registered this seller (owner O1: the partner credential is swappable).';--> statement-breakpoint
comment on column "store_mengantar_accounts"."pickup_address_id" is 'POST /address _id IN THIS seller account. Cleared when the store''s sender address changes.';--> statement-breakpoint

CREATE OR REPLACE VIEW "order_seller_entitlements" AS
 SELECT o.id AS order_id,
    o.store_id,
    COALESCE(f.shipping_charged_idr, o.shipping_idr) AS shipping_charged_idr,
    COALESCE(f.goods_proceeds_idr, GREATEST(o.subtotal_idr - o.discount_idr, 0)) AS goods_proceeds_idr,
    COALESCE(b.seller_debit_idr, 0::numeric) AS seller_shipping_debit_idr,
    f.order_id IS NULL AS legacy,
    (CASE WHEN f.order_id IS NULL
          THEN GREATEST(o.subtotal_idr - o.discount_idr, 0)::numeric
          ELSE f.goods_proceeds_idr::numeric
             + GREATEST(COALESCE(o.tax_idr, 0) - f.included_sales_tax_idr, 0)::numeric
     END) - COALESCE(b.seller_debit_idr, 0::numeric)
      + (CASE WHEN o.shipping_provider = 'mengantar' THEN GREATEST(COALESCE(f.shipping_charged_idr, o.shipping_idr), 0) ELSE 0 END)::numeric AS seller_entitlement_idr,
    (CASE WHEN f.order_id IS NULL THEN 0
          ELSE GREATEST(COALESCE(o.tax_idr, 0) - f.included_sales_tax_idr, 0)
     END) AS sales_tax_added_idr,
    (CASE WHEN o.shipping_provider = 'mengantar' THEN GREATEST(COALESCE(f.shipping_charged_idr, o.shipping_idr), 0) ELSE 0 END) AS shipping_pass_through_idr
   FROM orders o
     LEFT JOIN order_financials f ON f.order_id = o.id
     LEFT JOIN LATERAL ( SELECT sum(shipment_bookings.seller_debit_idr) AS seller_debit_idr
           FROM shipment_bookings
          WHERE shipment_bookings.order_id = o.id AND (shipment_bookings.status = ANY (ARRAY['accepted'::shipment_booking_status, 'cancellation_requested'::shipment_booking_status]))) b ON true;--> statement-breakpoint
comment on view "order_seller_entitlements" is
  'Seller entitlement per order. 0116: a Mengantar-stamped order adds the buyer-paid shipping (shipping_pass_through_idr) — the seller''s own Mengantar wallet paid the courier (owner O3). Must equal ledger-credit.ts creditSaleForPayment.';
