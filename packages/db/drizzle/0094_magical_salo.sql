DO $$ BEGIN
  CREATE TYPE "public"."shipment_booking_status" AS ENUM('reserved', 'unknown', 'accepted', 'cancellation_requested', 'failed', 'voided', 'refunded');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_financials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"goods_discount_idr" bigint DEFAULT 0 NOT NULL,
	"shipping_discount_idr" bigint DEFAULT 0 NOT NULL,
	"included_sales_tax_idr" bigint DEFAULT 0 NOT NULL,
	"goods_proceeds_idr" bigint DEFAULT 0 NOT NULL,
	"shipping_charged_idr" bigint DEFAULT 0 NOT NULL,
	"cod_fee_before_vat_idr" bigint DEFAULT 0 NOT NULL,
	"cod_fee_vat_idr" bigint DEFAULT 0 NOT NULL,
	"cod_fee_final_idr" bigint DEFAULT 0 NOT NULL,
	"order_payable_idr" bigint DEFAULT 0 NOT NULL,
	"expected_gateway_fee_idr" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_financials_orderId_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shipment_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider_reference" text NOT NULL,
	"provider_booking_id" text,
	"courier" text NOT NULL,
	"service_type" text NOT NULL,
	"service_name" text NOT NULL,
	"status" "shipment_booking_status" DEFAULT 'reserved' NOT NULL,
	"shipping_charged_idr" bigint DEFAULT 0 NOT NULL,
	"shipping_actual_idr" bigint DEFAULT 0 NOT NULL,
	"shipping_delta_idr" bigint DEFAULT 0 NOT NULL,
	"seller_debit_idr" bigint DEFAULT 0 NOT NULL,
	"platform_margin_idr" bigint DEFAULT 0 NOT NULL,
	"failure_note" text,
	"accepted_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_bookings_providerReference_unique" UNIQUE("provider_reference"),
	CONSTRAINT "shipment_bookings_providerBookingId_unique" UNIQUE("provider_booking_id")
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "shipment_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "component" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_financials" ADD CONSTRAINT "order_financials_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_financials" ADD CONSTRAINT "order_financials_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipment_bookings" ADD CONSTRAINT "shipment_bookings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipment_bookings" ADD CONSTRAINT "shipment_bookings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_financials_store_idx" ON "order_financials" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_bookings_store_order_idx" ON "shipment_bookings" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_one_active_per_order" ON "shipment_bookings" USING btree ("order_id") WHERE "shipment_bookings"."status" IN ('reserved', 'unknown', 'accepted', 'cancellation_requested');--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_shipment_booking_id_shipment_bookings_id_fk" FOREIGN KEY ("shipment_booking_id") REFERENCES "public"."shipment_bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ledger_one_adjustment_component_per_booking"
  ON "ledger_entries" ("shipment_booking_id", "component")
  WHERE "kind" = 'adjustment' AND "shipment_booking_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "order_financials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "order_financials";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_financials"
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint

ALTER TABLE "shipment_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "shipment_bookings";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shipment_bookings"
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint

-- Checkout allocations are immutable. Corrections belong in the append-only ledger/reconciliation
-- trail; mutating the snapshot would silently rewrite what the buyer and Seller agreed to.
CREATE OR REPLACE FUNCTION reject_order_financial_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_financials rows are immutable';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS order_financials_immutable ON "order_financials";--> statement-breakpoint
CREATE TRIGGER order_financials_immutable
  BEFORE UPDATE OR DELETE ON "order_financials"
  FOR EACH ROW EXECUTE FUNCTION reject_order_financial_mutation();--> statement-breakpoint

-- Deliberately no historical INSERT here. Legacy orders.discount_idr does not reveal whether the
-- discount funded goods or shipping, so an automatic backfill would fabricate seller proceeds.

CREATE OR REPLACE VIEW "order_seller_entitlements"
WITH (security_invoker = true) AS
SELECT
  o.id AS order_id,
  o.store_id,
  COALESCE(f.shipping_charged_idr, o.shipping_idr) AS shipping_charged_idr,
  COALESCE(f.goods_proceeds_idr, o.total_idr - o.tax_idr) AS goods_proceeds_idr,
  COALESCE(b.seller_debit_idr, 0) AS seller_shipping_debit_idr,
  (f.order_id IS NULL) AS legacy,
  COALESCE(f.goods_proceeds_idr, o.total_idr - o.tax_idr)
    - COALESCE(b.seller_debit_idr, 0) AS seller_entitlement_idr
FROM orders o
LEFT JOIN order_financials f ON f.order_id = o.id
LEFT JOIN LATERAL (
  SELECT sum(seller_debit_idr) AS seller_debit_idr
    FROM shipment_bookings
   WHERE order_id = o.id AND status IN ('accepted', 'cancellation_requested')
) b ON true;--> statement-breakpoint
GRANT SELECT ON "order_seller_entitlements" TO tokophi_app;--> statement-breakpoint