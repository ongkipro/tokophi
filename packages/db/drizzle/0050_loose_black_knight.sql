CREATE TYPE "public"."store_domain_status" AS ENUM('pending', 'verifying', 'provisioning', 'active', 'error', 'disabled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"host" text NOT NULL,
	"status" "store_domain_status" DEFAULT 'pending' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"provider_id" text,
	"cert_status" text,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_domains_host_key" ON "store_domains" USING btree ("host");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_domains_store_idx" ON "store_domains" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_domains_one_primary" ON "store_domains" USING btree ("store_id") WHERE is_primary;--> statement-breakpoint
-- RLS is mandatory: verify-rls derives the store-scoped set from the catalog (every table with a
-- store_id) and FAILS if one lacks a policy. Same `tenant_isolation` shape as every other tenant table.
-- The storefront resolves a host on the OWNER connection (no session → no GUC), exactly as
-- getStoreByHost() already does — so this policy governs admin reads/writes, not host resolution.
ALTER TABLE "store_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "store_domains";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_domains" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
