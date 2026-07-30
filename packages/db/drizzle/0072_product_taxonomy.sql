CREATE TABLE IF NOT EXISTS "product_taxonomy" (
	"id" integer PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"is_leaf" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "google_category_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "google_category_path" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_taxonomy_path_idx" ON "product_taxonomy" USING btree ("path");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_google_category_id_product_taxonomy_id_fk" FOREIGN KEY ("google_category_id") REFERENCES "public"."product_taxonomy"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
