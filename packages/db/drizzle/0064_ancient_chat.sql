-- promo_pages — per-product single-page order LANDING config (the /promo/<handle> funnel).
--
-- NOTE: `drizzle-kit generate` also emitted the orders.problem_* and stores.social_* ADD COLUMNs here
-- — those belong to 0062/0063, which were hand-authored and never refreshed the meta snapshot, so the
-- generator re-proposed them. They are ALREADY applied; re-running them would fail ("column already
-- exists"). Stripped. The 0064 snapshot now carries all of them, so future generates stay clean.
CREATE TABLE IF NOT EXISTS "promo_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"headline" text,
	"subheadline" text,
	"badge" text,
	"benefits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ideal_for" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"countdown_minutes" integer DEFAULT 0 NOT NULL,
	"show_scarcity" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_pages_storeId_productId_unique" UNIQUE("store_id","product_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promo_pages" ADD CONSTRAINT "promo_pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promo_pages" ADD CONSTRAINT "promo_pages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
