-- `payments` and `media` were the last store-scoped tables without RLS (whitelisted as
-- KNOWN_EXCEPTIONS in verify-rls). `payments` is the serious one: it is MONEY, it is written from
-- the merchant admin, and its tenant boundary rested purely on application code.
--
-- Worse, payments.store_id was NULLABLE and every seeded row had store_id = NULL — the column
-- existed but was never populated by the seed (the app write paths always set it). A nullable
-- tenant key is a silent hole: such a row matches NO tenant policy and belongs to nobody, so
-- enabling RLS without backfilling first would make every existing payment vanish.
--
-- Order matters: backfill from the parent order -> NOT NULL + FK -> enable RLS. Same shape as 0035.
UPDATE "payments" p SET "store_id" = o."store_id" FROM "orders" o WHERE o."id" = p."order_id" AND p."store_id" IS NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "store_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "payments";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint

-- `media` is empty today (product images actually live in product_media) but it carries a NOT NULL
-- store_id, so it is store-scoped by definition. Close it now rather than leave a loaded gun for
-- whoever writes the first row.
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "media";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "media" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
