CREATE TABLE IF NOT EXISTS "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sales_idr" bigint DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_daily_storeId_date_unique" UNIQUE("store_id","date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
