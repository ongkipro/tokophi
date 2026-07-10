-- ADR 0009 (Store Builder): page_templates is a new store-scoped table — extend the
-- tenant_isolation RLS pattern from 0012_tenant_rls.sql to cover it.
ALTER TABLE "page_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "page_templates";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "page_templates" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());