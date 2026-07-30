CREATE TYPE "public"."tracking_delivery_status" AS ENUM('queued', 'processing', 'succeeded', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracking_event_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"channel" "ad_channel_key" NOT NULL,
	"event_name" text NOT NULL,
	"event_id" text NOT NULL,
	"order_id" uuid,
	"status" "tracking_delivery_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_event_deliveries_storeId_channel_eventId_unique" UNIQUE("store_id","channel","event_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_event_deliveries" ADD CONSTRAINT "tracking_event_deliveries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_event_deliveries" ADD CONSTRAINT "tracking_event_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_event_deliveries_due_idx" ON "tracking_event_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_event_deliveries_store_idx" ON "tracking_event_deliveries" USING btree ("store_id","created_at");--> statement-breakpoint
-- RLS (ADR 0012 §0.4). Store-scoped table → same tenant_isolation policy as every other one, and
-- `verify-rls` (which derives its set from the `store_id` column) will REQUIRE it. The Admin reads its
-- diagnostics under `tokophi_app` (withCurrentTenant), so this policy is the isolation. The enqueue and
-- the cron drain run as OWNER — the documented exception (like /api/public/order) — and MUST therefore
-- carry an explicit `store_id` on every query; RLS is the net, the WHERE is the rule.
ALTER TABLE "tracking_event_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "tracking_event_deliveries";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tracking_event_deliveries" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());