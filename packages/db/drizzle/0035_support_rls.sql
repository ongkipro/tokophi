-- support_tickets / support_messages were added in 0030 — AFTER the tenant RLS migration
-- 0012 — and never got RLS. Tenant isolation for them rested purely on an application-side
-- `where store_id = …` filter (apps/admin/lib/actions/support.ts). Retrofit the standard
-- pattern: store_id on both tables + `tenant_isolation` policies keyed on app_current_store_id().
-- support_messages has no store_id today → add it nullable, backfill from the parent ticket,
-- then make it NOT NULL + FK (a plain `ADD COLUMN … NOT NULL` would fail on existing rows).
ALTER TABLE "support_messages" ADD COLUMN IF NOT EXISTS "store_id" uuid;--> statement-breakpoint
UPDATE "support_messages" m SET "store_id" = t."store_id" FROM "support_tickets" t WHERE t."id" = m."ticket_id" AND m."store_id" IS NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ALTER COLUMN "store_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "support_tickets";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "support_tickets" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "support_messages";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "support_messages" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
