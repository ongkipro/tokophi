-- TOKOPHI ACCOUNT — phase 1 buyer half (specs/docs/TOKOPHI_ACCOUNT_SPEC.md §17.9, Tasks 10.5–10.9).
--
-- The ONLY bridge between a platform account and a store's orders is an explicit claim (ACC-11):
-- the buyer holds the claim token the order API returned on the success page (D-3), signs in,
-- accepts a consent screen naming the store, and then exactly two rows are written — the claim
-- (`buyer_order_claims`, single claimant per order) and the link to that store
-- (`buyer_store_links`, re-activated if it existed). Nothing is ever matched by email or phone.
--
-- `buyer_store_links` and `buyer_order_claims` carry `store_id`, so they get the standard tenant
-- policy: a Seller path running as `tokophi_app` sees only its own store's rows. apps/account reads
-- them on the owner connection with an explicit buyer_id predicate (§17.8 D-4), held by tests.
-- `buyer_addresses` has no store_id: RLS on, no policy (the 0117 `buyer_accounts` shape).
--
-- Additive and idempotent (AGENTS.md: drizzle applies the pending batch in one transaction).
create table if not exists "buyer_store_links" (
  "id" uuid primary key default gen_random_uuid() not null,
  "buyer_id" uuid not null references "buyer_accounts"("id"),
  "store_id" uuid not null references "stores"("id"),
  "customer_id" uuid references "customers"("id"),
  "status" text default 'active' not null,
  "consent_version" text not null,
  "consented_at" timestamp with time zone default now() not null,
  "revoked_at" timestamp with time zone,
  "claim_method" text default 'token' not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "buyer_store_links_buyer_id_store_id_unique" unique ("buyer_id", "store_id"),
  constraint "buyer_store_links_status_check" check ("status" in ('active', 'revoked')),
  constraint "buyer_store_links_claim_method_check" check ("claim_method" in ('token', 'phone'))
);--> statement-breakpoint
create index if not exists "buyer_store_links_store_idx" on "buyer_store_links" ("store_id");--> statement-breakpoint

create table if not exists "buyer_order_claims" (
  "id" uuid primary key default gen_random_uuid() not null,
  "order_id" uuid not null references "orders"("id"),
  "buyer_id" uuid not null references "buyer_accounts"("id"),
  "store_id" uuid not null references "stores"("id"),
  "claimed_at" timestamp with time zone default now() not null,
  constraint "buyer_order_claims_order_id_unique" unique ("order_id")
);--> statement-breakpoint
create index if not exists "buyer_order_claims_buyer_idx" on "buyer_order_claims" ("buyer_id", "store_id");--> statement-breakpoint

create table if not exists "buyer_addresses" (
  "id" uuid primary key default gen_random_uuid() not null,
  "buyer_id" uuid not null references "buyer_accounts"("id"),
  "label" text,
  "recipient" text not null,
  "phone" text not null,
  "address" text not null,
  "district_id" integer not null references "kiriminaja_areas"("id"),
  "kelurahan" text,
  "postal_code" text not null,
  "is_primary" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);--> statement-breakpoint
create index if not exists "buyer_addresses_buyer_idx" on "buyer_addresses" ("buyer_id");--> statement-breakpoint
create unique index if not exists "buyer_addresses_one_primary" on "buyer_addresses" ("buyer_id") where "is_primary";--> statement-breakpoint

alter table "buyer_store_links" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "buyer_store_links";--> statement-breakpoint
create policy "tenant_isolation" on "buyer_store_links"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
alter table "buyer_order_claims" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "buyer_order_claims";--> statement-breakpoint
create policy "tenant_isolation" on "buyer_order_claims"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
alter table "buyer_addresses" enable row level security;--> statement-breakpoint

comment on table "buyer_order_claims" is
  'An order saved to a TokoΦ Account (ACC-11): written only by apps/account after a valid claim token (D-3) and an accepted consent screen. order_id unique = one claimant per order, ever.';--> statement-breakpoint
comment on table "buyer_store_links" is
  'The buyer''s consent to see their orders from one store in the account (ACC-11/ACC-8). revoked = the store leaves the hub; claims stay recorded but hidden. Writing or revoking it never touches a store-owned row.';--> statement-breakpoint
comment on table "buyer_addresses" is
  'Saved addresses of a TokoΦ Account (ACC-7): max 10 (enforced in apps/account), at most one primary (partial unique). An order keeps its own ship_* snapshot; editing here never changes one.';
