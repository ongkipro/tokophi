-- landing_pages — custom-HTML landing (/lp/<slug>): merchant pastes their own markup + picks a product
-- for the checkout. Keyed by (store_id, slug). RLS added in 0068 (store-scoped).
CREATE TABLE IF NOT EXISTS "landing_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"product_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"countdown_minutes" integer DEFAULT 0 NOT NULL,
	"show_scarcity" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landing_pages_storeId_slug_unique" UNIQUE("store_id","slug")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
