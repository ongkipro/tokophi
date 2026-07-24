CREATE TABLE IF NOT EXISTS "flash_sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flash_sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sale_price_idr" bigint NOT NULL,
	CONSTRAINT "flash_sale_items_flashSaleId_productId_unique" UNIQUE("flash_sale_id","product_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flash_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "discount_status" DEFAULT 'terjadwal' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_flash_sale_id_flash_sales_id_fk" FOREIGN KEY ("flash_sale_id") REFERENCES "public"."flash_sales"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "flash_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "flash_sales";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "flash_sales" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
