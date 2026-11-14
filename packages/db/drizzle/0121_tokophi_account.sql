-- BUYER-ACCOUNT-P1 (ADR 0016, accepted 2026-11-14; Task 5.8) — the TokoΦ Account identity.
-- Ported from PR #424 (`0117_tokophi_account`) WITHOUT its affiliate half: the `affiliates.account_id` /
-- invitation columns belong to the store-affiliate phase 2 and are not created here. Also without the
-- phase-2 phone columns (`phone`, `phone_verified_at`): no phone verification exists, so `google_sub`
-- is the one identity and is NOT NULL.
--
-- ONE platform account per person, used by apps/account (account.tokophi.com). It is cross-tenant
-- platform data and has no `store_id` on purpose: a buyer is not a store's row. RLS is ENABLED WITH NO
-- POLICY (the 0098 `impersonation_grants` / 0106 `rate_limit_counters` shape): the restricted
-- `tokophi_app` role — every tenant-scoped Seller read and write — sees ZERO rows, so no Seller path can
-- read an account's email, name or devices even by mistake. apps/account runs on the owner connection
-- and every statement there carries an explicit `buyer_id` / session-id predicate (held by
-- apps/account/src/data/*.test.ts).
--
-- Sign-in is Google only (plus a local-dev email sign-in that a production build refuses): no password
-- is ever minted or stored for a buyer. Closing an account rewrites `google_sub` to an inert
-- `closed:<id>` marker so the same Google account later starts a NEW, empty account.
-- `buyer_sessions` is the server-side session row the `tphi_account` cookie names — the row decides on
-- every request (revoked / older than 30 days / account not active ⇒ signed out), never the cookie.
--
-- Additive and idempotent (AGENTS.md: drizzle applies the pending batch in ONE transaction).
create table if not exists "buyer_accounts" (
  "id" uuid primary key default gen_random_uuid() not null,
  "google_sub" text not null,
  "email" text,
  "name" text,
  "status" text default 'active' not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "buyer_accounts_google_sub_unique" unique ("google_sub"),
  constraint "buyer_accounts_status_check" check ("status" in ('active', 'suspended', 'closed'))
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
comment on table "buyer_accounts" is
  'TokoΦ Account (apps/account, ADR 0016): one platform identity per person. Cross-tenant, no store_id; RLS on with NO policy so tokophi_app (every Seller path) sees nothing. apps/account reads only with an explicit buyer_id predicate. google_sub "dev:<email>" exists only from local dev sign-in (refused in production builds); "closed:<id>" marks a closed account.';--> statement-breakpoint
comment on table "buyer_sessions" is
  'Server-side session of a TokoΦ Account; the tphi_account cookie (jose JWT, audience tokophi-account) carries only this id. Revoked, older than 30 days, or a non-active account = signed out.';
