-- TOKOPHI ACCOUNT — phase 1 identity (specs/docs/TOKOPHI_ACCOUNT_SPEC.md §17.9, AFFILIATE_SPEC F-A15,
-- owner 2026-10-15: "akun affiliate itu buat seperti akun user -> jadi bisa affiliate banyak toko").
--
-- ONE platform account per person, used by apps/account for both the buyer area and the affiliate
-- area. It is cross-tenant platform data: no `store_id`. RLS is ENABLED WITH NO POLICY (the 0098
-- `impersonation_grants` / 0106 `rate_limit_counters` shape): the restricted `tokophi_app` role sees
-- zero rows, so no tenant-scoped Seller path can ever read an account; apps/account runs on the owner
-- connection and every read there carries an explicit `buyer_id` predicate (spec §17.8 D-4), held by
-- negative tests.
-- An affiliate stays a PER-STORE row (`affiliates`, 0116; the merchant approves per store); this only
-- adds the optional link from that row to an account, so one account is an affiliate of many stores.
--
-- Binding an existing affiliate row to an account happens ONLY through a seller-issued invitation
-- (`invite_hash`, single use, 7 days) — never by matching email or phone (ACC-14).
--
-- Additive and idempotent (AGENTS.md: drizzle applies the pending batch in one transaction).
create table if not exists "buyer_accounts" (
  "id" uuid primary key default gen_random_uuid() not null,
  "google_sub" text,
  "email" text,
  "phone" text,
  "phone_verified_at" timestamp with time zone,
  "name" text,
  "status" text default 'active' not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "buyer_accounts_google_sub_unique" unique ("google_sub"),
  constraint "buyer_accounts_phone_unique" unique ("phone"),
  constraint "buyer_accounts_status_check" check ("status" in ('active', 'suspended', 'closed')),
  constraint "buyer_accounts_identity_check" check ("google_sub" is not null or "phone" is not null)
);--> statement-breakpoint

create table if not exists "buyer_sessions" (
  "id" uuid primary key default gen_random_uuid() not null,
  "buyer_id" uuid not null references "buyer_accounts"("id"),
  "created_at" timestamp with time zone default now() not null,
  "last_seen_at" timestamp with time zone default now() not null,
  "revoked_at" timestamp with time zone,
  "user_agent" text
);--> statement-breakpoint
create index if not exists "buyer_sessions_buyer_idx" on "buyer_sessions" ("buyer_id");--> statement-breakpoint
alter table "buyer_accounts" enable row level security;--> statement-breakpoint
alter table "buyer_sessions" enable row level security;--> statement-breakpoint

alter table "affiliates" add column if not exists "account_id" uuid references "buyer_accounts"("id");--> statement-breakpoint
alter table "affiliates" add column if not exists "invite_hash" text;--> statement-breakpoint
alter table "affiliates" add column if not exists "invite_expires_at" timestamp with time zone;--> statement-breakpoint
do $$ begin
  alter table "affiliates" add constraint "affiliates_store_id_account_id_unique" unique ("store_id", "account_id");
exception when duplicate_object or duplicate_table then null; end $$;--> statement-breakpoint
create index if not exists "affiliates_account_idx" on "affiliates" ("account_id");--> statement-breakpoint
create unique index if not exists "affiliates_invite_hash_idx" on "affiliates" ("invite_hash") where "invite_hash" is not null;--> statement-breakpoint

comment on table "buyer_accounts" is
  'TokoΦ Account (apps/account): one platform identity per person — buyer area and affiliate area. Cross-tenant, no store_id, no RLS; apps/account reads only with an explicit buyer_id predicate. google_sub "dev:<email>" exists only on local dev sign-in (refused in production builds).';--> statement-breakpoint
comment on column "affiliates"."account_id" is
  'TokoΦ Account that owns this per-store affiliate row (0117). Set by applying while signed in, or by accepting the seller''s invitation (invite_hash, single use). Never by email/phone match.';
