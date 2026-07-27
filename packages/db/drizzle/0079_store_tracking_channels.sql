CREATE TABLE IF NOT EXISTS "store_tracking_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"channel" "ad_channel_key" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"pixel_id" text,
	"capi_enabled" boolean DEFAULT false NOT NULL,
	"capi_token_ciphertext" text,
	"advanced_matching" boolean DEFAULT false NOT NULL,
	"test_event_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_tracking_channels_storeId_channel_unique" UNIQUE("store_id","channel")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_tracking_channels" ADD CONSTRAINT "store_tracking_channels_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "store_tracking_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "store_tracking_channels";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_tracking_channels" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
