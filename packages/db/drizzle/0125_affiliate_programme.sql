-- AFFILIATE-P2 (ADR 0022, owner 2026-11-14) — the store affiliate programme, with its OWN accounts.
--
-- Ported from the never-merged PRs #424 (`0116_store_affiliates`, the `affiliates.account_id` half of
-- `0117_tokophi_account`), #431/#455 (`0122_affiliate_commissions_affiliate_idx`) — with the identity
-- model the owner changed on 2026-11-14: an affiliate signs in with EMAIL + PASSWORD at
-- affiliate.tokophi.com (apps/affiliate) and is NOT a buyer "Akun TokoΦ" (buyer_accounts, 0121). The two
-- identities share nothing: no column here references buyer_accounts, and nothing in 0121–0124 is touched.
--
-- What a store gets: the merchant switches the programme on per store (`store_settings.affiliate_enabled`,
-- default false — no existing store changes behaviour on deploy), approves affiliates, and an order
-- carrying an affiliate's code (typed, or a captured `?ref=`) gets ONE commission row frozen at order time.
-- The merchant pays the affiliate OUTSIDE TokoΦ and marks the row `dibayar`; nothing here touches
-- `ledger_entries` or `payouts` — the platform never holds affiliate money.
-- "Siap dibayar" is DERIVED (status = 'pending' and eligible_at <= now()), never stored, so no cron has to
-- promote rows and no row can sit in a state the clock already left. Rates are integer BASIS POINTS
-- (1000 = 10%): a commission is never computed in floating point.
--
-- Platform identity (`affiliate_accounts`, `affiliate_sessions`): cross-tenant, no store_id, RLS ENABLED
-- WITH NO POLICY (the 0098 / 0106 / 0121 shape) — the restricted `tokophi_app` role, i.e. every Seller
-- read and write, sees ZERO rows, so no Seller path can read an affiliate's email or devices even by
-- mistake. apps/affiliate runs on the owner connection and every statement carries an explicit
-- account / session predicate. A session row is keyed by the sha256 of an opaque random token; the
-- token itself exists only in the affiliate's HttpOnly cookie.
--
-- Store-scoped rows (`affiliates`, `affiliate_commissions`): standard `tenant_isolation`. The 2026-10-29
-- audit gaps (specs/docs/tasks/OPEN.md) are closed IN THE SCHEMA, not in code that a later edit can skip:
--   · UNIQUE (store_id, phone) — one affiliate row per phone per store;
--   · CHECK commission_idr >= 0 and base_idr >= 0 — a commission is never a debt;
--   · FK (affiliate_id, store_id) → affiliates (id, store_id) — a commission can only name an affiliate
--     of ITS OWN store (the owner-connection order path writes it; a bug there now fails, not leaks).
--
-- Every table is new, so constraints sit inline. Idempotent anyway (AGENTS.md): drizzle applies the whole
-- pending batch in ONE transaction, so a single "already exists" rolls back every migration behind it.
do $$ begin
  create type "affiliate_status" as enum ('menunggu', 'aktif', 'ditolak', 'nonaktif');
exception when duplicate_object then null; end $$;--> statement-breakpoint
do $$ begin
  create type "affiliate_commission_status" as enum ('pending', 'dibayar', 'batal');
exception when duplicate_object then null; end $$;--> statement-breakpoint

alter table "store_settings" add column if not exists "affiliate_enabled" boolean default false not null;--> statement-breakpoint
alter table "store_settings" add column if not exists "affiliate_rate_bps" integer default 1000 not null;--> statement-breakpoint
alter table "store_settings" add column if not exists "affiliate_hold_days" integer default 3 not null;--> statement-breakpoint
alter table "store_settings" drop constraint if exists "store_settings_affiliate_rate_check";--> statement-breakpoint
alter table "store_settings" add constraint "store_settings_affiliate_rate_check"
  check ("affiliate_rate_bps" between 0 and 10000);--> statement-breakpoint
alter table "store_settings" drop constraint if exists "store_settings_affiliate_hold_check";--> statement-breakpoint
alter table "store_settings" add constraint "store_settings_affiliate_hold_check"
  check ("affiliate_hold_days" between 0 and 90);--> statement-breakpoint
alter table "products" add column if not exists "affiliate_rate_bps" integer;--> statement-breakpoint
alter table "products" drop constraint if exists "products_affiliate_rate_check";--> statement-breakpoint
alter table "products" add constraint "products_affiliate_rate_check"
  check ("affiliate_rate_bps" is null or "affiliate_rate_bps" between 0 and 10000);--> statement-breakpoint

create table if not exists "affiliate_accounts" (
  "id" uuid primary key default gen_random_uuid() not null,
  "email" text not null,
  "name" text not null,
  "phone" text not null,
  "password_hash" text not null,
  "created_at" timestamp with time zone default now() not null,
  "disabled_at" timestamp with time zone,
  constraint "affiliate_accounts_email_unique" unique ("email"),
  constraint "affiliate_accounts_email_lower_check" check ("email" = lower("email"))
);--> statement-breakpoint
create table if not exists "affiliate_sessions" (
  "id" uuid primary key default gen_random_uuid() not null,
  "token_hash" text not null,
  "account_id" uuid not null references "affiliate_accounts"("id"),
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone not null,
  "last_seen_at" timestamp with time zone default now() not null,
  "revoked_at" timestamp with time zone,
  "user_agent" text,
  constraint "affiliate_sessions_token_hash_unique" unique ("token_hash")
);--> statement-breakpoint
create index if not exists "affiliate_sessions_account_idx" on "affiliate_sessions" ("account_id");--> statement-breakpoint
alter table "affiliate_accounts" enable row level security;--> statement-breakpoint
alter table "affiliate_sessions" enable row level security;--> statement-breakpoint

create table if not exists "affiliates" (
  "id" uuid primary key default gen_random_uuid() not null,
  "store_id" uuid not null references "stores"("id"),
  "account_id" uuid references "affiliate_accounts"("id"),
  "code" text not null,
  "name" text not null,
  "phone" text not null,
  "email" text,
  "bank_name" text,
  "bank_account" text,
  "bank_holder" text,
  "status" "affiliate_status" default 'menunggu' not null,
  "note" text,
  "invite_hash" text,
  "invite_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "approved_at" timestamp with time zone,
  constraint "affiliates_store_id_code_unique" unique ("store_id", "code"),
  constraint "affiliates_store_id_phone_unique" unique ("store_id", "phone"),
  constraint "affiliates_store_id_account_id_unique" unique ("store_id", "account_id"),
  -- The target of affiliate_commissions' composite FK (Postgres needs a unique on exactly these columns).
  constraint "affiliates_id_store_id_unique" unique ("id", "store_id")
);--> statement-breakpoint
create index if not exists "affiliates_store_status_idx" on "affiliates" ("store_id", "status");--> statement-breakpoint
create index if not exists "affiliates_account_idx" on "affiliates" ("account_id");--> statement-breakpoint
create unique index if not exists "affiliates_invite_hash_idx" on "affiliates" ("invite_hash") where "invite_hash" is not null;--> statement-breakpoint

create table if not exists "affiliate_commissions" (
  "id" uuid primary key default gen_random_uuid() not null,
  "store_id" uuid not null references "stores"("id"),
  "affiliate_id" uuid not null,
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
  constraint "affiliate_commissions_order_id_unique" unique ("order_id"),
  constraint "affiliate_commissions_affiliate_store_fk" foreign key ("affiliate_id", "store_id")
    references "affiliates" ("id", "store_id"),
  constraint "affiliate_commissions_amounts_check" check ("commission_idr" >= 0 and "base_idr" >= 0),
  constraint "affiliate_commissions_source_check" check ("source" in ('kode', 'link'))
);--> statement-breakpoint
create index if not exists "affiliate_commissions_store_idx" on "affiliate_commissions" ("store_id", "status");--> statement-breakpoint
create index if not exists "affiliate_commissions_affiliate_idx" on "affiliate_commissions" ("affiliate_id", "status");--> statement-breakpoint

alter table "affiliates" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "affiliates";--> statement-breakpoint
create policy "tenant_isolation" on "affiliates"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
alter table "affiliate_commissions" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "affiliate_commissions";--> statement-breakpoint
create policy "tenant_isolation" on "affiliate_commissions"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint

comment on table "affiliate_accounts" is
  'Affiliate identity (apps/affiliate, affiliate.tokophi.com, ADR 0022): email + scrypt password, separate from buyer_accounts. Cross-tenant, no store_id; RLS on with NO policy so tokophi_app (every Seller path) sees nothing. email is stored lower-cased. disabled_at set = cannot sign in.';--> statement-breakpoint
comment on table "affiliate_sessions" is
  'Server-side affiliate session (ADR 0022). token_hash = sha256 of the opaque token in the tphi_affiliate cookie; the token itself is never stored. Revoked, expired, or a disabled account = signed out.';--> statement-breakpoint
comment on column "affiliates"."account_id" is
  'affiliate_accounts row that owns this per-store affiliate row (ADR 0022). Set by applying while signed in at affiliate.tokophi.com, or by accepting the seller''s invitation (invite_hash, single use). NEVER by email/phone match.';--> statement-breakpoint
comment on column "affiliates"."invite_hash" is
  'sha256 of the seller-issued invitation token (7 days, single use: cleared by the one UPDATE that binds account_id).';--> statement-breakpoint
comment on table "affiliate_commissions" is
  'One commission per attributed order, frozen at order time. pending -> dibayar (merchant marked it paid after paying outside TokoΦ) or batal (order batal/retur). Payable = pending and eligible_at <= now(); eligible_at is set when the order reaches selesai (+ store_settings.affiliate_hold_days).';--> statement-breakpoint
comment on column "products"."affiliate_rate_bps" is
  'Affiliate commission override in basis points (1000 = 10%). NULL = store_settings.affiliate_rate_bps; 0 = no commission on this product.';--> statement-breakpoint
comment on column "store_settings"."affiliate_enabled" is
  'The seller''s own switch for the affiliate programme (ADR 0022). false (default) = no code field at checkout, no commission, /affiliate answers 404, nobody can apply.';
