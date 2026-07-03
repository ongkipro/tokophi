CREATE TABLE IF NOT EXISTS "store_stats" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"gmv_idr" bigint DEFAULT 0 NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"products_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "city" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_stats" ADD CONSTRAINT "store_stats_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
