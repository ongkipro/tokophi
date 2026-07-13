-- Saldo: the merchant's money, and the book that tracks it.
--
-- TokoΦ has been collecting payments on the merchant's behalf while keeping NO RECORD of what it
-- owes them. There is no ledger, no payout, no balance — the Saldo chip in the topbar is
-- `sum(payments)`, which is a number, not a book. A merchant cannot ask "which of my money has
-- settled, which is still in transit, which came back as a return?" and get an answer.
--
-- One SIGNED entry per movement; the balance is derived, never stored:
--   sale   +amount  pending    → owed once the order sticks
--   sale   +amount  available  → released
--   retur  -amount  available  → parcel came back; claw the credit back
--   payout -amount  available  → paid to the merchant's bank
--
--   saldo tersedia    = Σ amount WHERE status = 'available'
--   dana dalam proses = Σ amount WHERE status = 'pending'
--
-- Append-only: money is never edited in place. A mistake is corrected with a new opposing entry,
-- so the book can always be replayed and audited.
--
-- RELEASE RULE — release on `selesai`, NOT on `dikirim`. Despatch-time release looks generous and
-- is a trap: `retur` can only happen to an order that ALREADY SHIPPED, so a merchant could
-- withdraw money for a parcel that later comes back and the platform eats the difference. For COD
-- it is worse — at "dikirim" the cash does not exist yet; the courier collects at the door and
-- settles days later. Crediting there means crediting money nobody is holding. Kept as a platform
-- SETTING so it can be loosened without a deploy, but it defaults to the safe end deliberately.
CREATE TYPE "ledger_kind" AS ENUM ('sale', 'retur', 'payout', 'adjustment');--> statement-breakpoint
CREATE TYPE "ledger_status" AS ENUM ('pending', 'available');--> statement-breakpoint
CREATE TYPE "payout_status" AS ENUM ('menunggu', 'diproses', 'selesai', 'gagal');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "order_id" uuid,
  "payout_id" uuid,
  "kind" "ledger_kind" NOT NULL,
  "status" "ledger_status" DEFAULT 'pending' NOT NULL,
  "amount_idr" bigint DEFAULT 0 NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "available_at" timestamp with time zone
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "amount_idr" bigint DEFAULT 0 NOT NULL,
  "status" "payout_status" DEFAULT 'menunggu' NOT NULL,
  "bank_name" text,
  "bank_account" text,
  "bank_holder" text,
  "note" text,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paid_at" timestamp with time zone
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_payout" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "release_on" text DEFAULT 'selesai' NOT NULL,
  "min_payout_idr" bigint DEFAULT 50000 NOT NULL,
  "auto_approve" boolean DEFAULT false NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payouts" ADD CONSTRAINT "payouts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- One sale entry per order, enforced by the DB rather than by hoping the app never double-fires.
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_one_sale_per_order" ON "ledger_entries" ("order_id") WHERE "kind" = 'sale';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_one_retur_per_order" ON "ledger_entries" ("order_id") WHERE "kind" = 'retur';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_store_status_idx" ON "ledger_entries" ("store_id", "status");--> statement-breakpoint

-- Money is store-scoped merchant data: the DB is the tenant boundary, not a hand-written WHERE.
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "ledger_entries";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ledger_entries" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "payouts";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payouts" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint

ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "bank_name" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "bank_account" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "bank_holder" text;--> statement-breakpoint

INSERT INTO "platform_payout" ("release_on") SELECT 'selesai' WHERE NOT EXISTS (SELECT 1 FROM "platform_payout");
