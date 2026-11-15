-- BUYER-ACCOUNT-P1 (ADR 0016) — the ONLY bridge between a TokoΦ Account and a store's orders.
-- Ported from PR #424 (`0118_buyer_order_claims`) WITHOUT `buyer_addresses` (saved addresses have no
-- consumer yet — checkout autofill is not built — so the table is not created) and WITHOUT
-- `buyer_store_links.claim_method` (only the token claim exists; ADR 0016 refuses a phone match).
--
-- A claim is explicit (ADR 0016 "consent-gated linking"): the buyer holds the claim token
-- /api/public/order returned on the success page (HMAC-bound to ONE order id, 30 days), signs in, and
-- ticks a consent box naming the store. Then exactly two rows are written in one transaction: the claim
-- (`buyer_order_claims`, `order_id` UNIQUE = one claimant per order, ever) and the buyer's link to that
-- store (`buyer_store_links`, re-activated if it existed). Nothing is ever matched by email or phone.
--
-- Both tables carry `store_id`, so they get the standard tenant policy: a Seller path running as
-- `tokophi_app` sees only ITS store's rows — exactly the merchant projection ADR 0016 allows ("this
-- customer is connected; these of YOUR orders are saved"). `buyer_id` is an opaque uuid to the Seller:
-- `buyer_accounts` (0121) has no policy, so a join to an email or name returns nothing there.
-- apps/account reads both tables on the owner connection with an explicit buyer_id predicate.
--
-- Child-table rule: neither table lacks store_id, and the claim write copies `store_id` from the ORDER
-- row it read inside the same transaction, never from the request.
--
-- Additive and idempotent (AGENTS.md: drizzle applies the pending batch in ONE transaction).
create table if not exists "buyer_store_links" (
  "id" uuid primary key default gen_random_uuid() not null,
  "buyer_id" uuid not null references "buyer_accounts"("id"),
  "store_id" uuid not null references "stores"("id"),
  "customer_id" uuid references "customers"("id"),
  "status" text default 'active' not null,
  "consent_version" text not null,
  "consented_at" timestamp with time zone default now() not null,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  constraint "buyer_store_links_buyer_id_store_id_unique" unique ("buyer_id", "store_id"),
  constraint "buyer_store_links_status_check" check ("status" in ('active', 'revoked'))
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
alter table "buyer_store_links" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "buyer_store_links";--> statement-breakpoint
create policy "tenant_isolation" on "buyer_store_links"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
alter table "buyer_order_claims" enable row level security;--> statement-breakpoint
drop policy if exists "tenant_isolation" on "buyer_order_claims";--> statement-breakpoint
create policy "tenant_isolation" on "buyer_order_claims"
  using (store_id = app_current_store_id()) with check (store_id = app_current_store_id());--> statement-breakpoint
comment on table "buyer_order_claims" is
  'An order saved to a TokoΦ Account (ADR 0016): written only by apps/account after a valid claim token and an accepted consent screen. order_id unique = one claimant per order, ever. store_id copied from the order row.';--> statement-breakpoint
comment on table "buyer_store_links" is
  'A buyer''s recorded consent to see one store''s orders in their account (ADR 0016). revoked = the buyer unlinked the store; claims stay recorded but hidden. The Seller sees only its own rows (tenant policy) and never the account behind buyer_id.';
