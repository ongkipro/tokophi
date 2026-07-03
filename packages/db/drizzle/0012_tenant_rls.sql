-- Tenant isolation via Row-Level Security (RLS).
-- Enforcement model: a per-request GUC "app.store_id" carries the current tenant.
--   * Locally: set via set_config('app.store_id', <uuid>, true) inside a txn (see withTenant / verify-rls).
--   * On the VPS: PostgREST sets it from the JWT "store_id" claim per request.
-- Policies below restrict every store-scoped table to rows of that store. The table
-- OWNER bypasses RLS, so tooling (migrate/seed) is unaffected; the app connects as the
-- non-owner role "indostore_app" (created here) for which the policies ARE enforced.
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'indostore_app') THEN
    CREATE ROLE indostore_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO indostore_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO indostore_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO indostore_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO indostore_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO indostore_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_store_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.store_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE "store_stats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "store_stats";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_stats" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "store_users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "store_users";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_users" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "locations";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "locations" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "products";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "product_variants";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_variants" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "collections";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "collections" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "suppliers";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "suppliers" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "purchase_orders";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_orders" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "stock_transfers";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_transfers" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "customers";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "orders";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "orders" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "customer_segments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "customer_segments";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_segments" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "reviews";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reviews" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "leads";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "leads" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "followups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "followups";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "followups" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "wa_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "wa_templates";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "wa_templates" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "wa_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "wa_messages";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "wa_messages" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "discounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "discounts";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "discounts" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "pages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "pages";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pages" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "blogs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "blogs";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "blogs" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "articles";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "articles" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "menus" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "menus";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "menus" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "ad_channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "ad_channels";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ad_channels" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "ad_metrics" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "ad_metrics";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ad_metrics" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "analytics_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "analytics_events";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "analytics_events" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "analytics_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "analytics_daily";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "analytics_daily" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "store_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "store_settings";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_settings" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "store_payment_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "store_payment_methods";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_payment_methods" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "store_shipping_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "store_shipping_methods";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_shipping_methods" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "domains" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "domains";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "domains" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "notification_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "notification_templates";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_templates" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "invoices";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoices" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());