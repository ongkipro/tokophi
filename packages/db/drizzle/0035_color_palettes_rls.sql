-- ADR 0009 amendment 2 (Palet Warna): color_palettes is a new store-scoped table — extend the
-- tenant_isolation RLS pattern from 0012_tenant_rls.sql to cover it.
ALTER TABLE "color_palettes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "color_palettes";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "color_palettes" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
