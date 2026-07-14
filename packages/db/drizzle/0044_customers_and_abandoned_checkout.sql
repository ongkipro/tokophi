-- Two gaps, one migration, both about the shopper.
--
-- 1. GUEST vs REGISTERED. `customers` had no notion of an account at all. Buying must NEVER require
--    a login — a registration wall in front of an Indonesian checkout is the most reliable way to
--    lose the sale — but a merchant still needs to know who came back and who was passing through.
--    `registered_at IS NULL` = guest. The identity that actually matters is the PHONE: Indonesian
--    shoppers give a WhatsApp number far more readily than an email, and WhatsApp is the channel
--    every follow-up actually travels on.
--
-- 2. ABANDONED CHECKOUT. Indonesia abandons ~82-83% of carts, against a ~70% global figure — and we
--    recorded NONE of them. No cart table existed. The single largest pool of nearly-made sales was
--    invisible.
--
--    Worse: the CRM was ALREADY showing "keranjang ditinggal" follow-ups, with a WhatsApp template
--    ready to send — and there was no cart behind any of them. It was telling merchants to chase a
--    basket that never existed. The follow-up was real; the thing it referred to was not.
--
--    There is no "abandon" event to listen for. Abandonment is the ABSENCE of one — a session that
--    stops updating and never becomes an order. So the row is written PROGRESSIVELY as the shopper
--    types, and it is judged later by what did not happen to it.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "password_hash" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_order_at" timestamp with time zone;--> statement-breakpoint

-- Backfill last_order_at from the orders that already exist. Nothing else is inferred: every
-- existing customer stays a GUEST, because none of them ever had an account to register with.
-- Marking them "registered" would be inventing a fact.
UPDATE "customers" c
   SET "last_order_at" = o.last_at
  FROM (SELECT customer_id, max(placed_at) AS last_at FROM "orders" WHERE customer_id IS NOT NULL GROUP BY 1) o
 WHERE o.customer_id = c."id";--> statement-breakpoint

CREATE TYPE "checkout_status" AS ENUM ('aktif', 'ditinggal', 'pulih', 'kedaluwarsa');--> statement-breakpoint
CREATE TYPE "checkout_step" AS ENUM ('keranjang', 'kontak', 'alamat', 'pengiriman', 'pembayaran');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "checkout_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "session_id" text NOT NULL,
  "customer_id" uuid,
  "name" text,
  "phone" text,
  "email" text,
  "address" text,
  "city" text,
  "province" text,
  "postcode" text,
  "district_id" integer,
  "items" jsonb,
  "subtotal_idr" bigint DEFAULT 0 NOT NULL,
  "shipping_idr" bigint DEFAULT 0 NOT NULL,
  "step" "checkout_step" DEFAULT 'keranjang' NOT NULL,
  "status" "checkout_status" DEFAULT 'aktif' NOT NULL,
  "recovered_order_id" uuid,
  "recovered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- One live session per storefront session, so a shopper typing into the form UPDATES their row
-- instead of leaving a trail of half-filled duplicates behind them.
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_sessions_store_session_uq" ON "checkout_sessions" ("store_id", "session_id");--> statement-breakpoint
-- The query the merchant actually runs: "what was abandoned, newest first".
CREATE INDEX IF NOT EXISTS "checkout_sessions_store_status_idx" ON "checkout_sessions" ("store_id", "status", "updated_at");--> statement-breakpoint

-- A half-typed checkout carries a name, a phone and an address. It is merchant data, and the tenant
-- boundary is the DATABASE, not a hand-written WHERE.
ALTER TABLE "checkout_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "checkout_sessions";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "checkout_sessions" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
