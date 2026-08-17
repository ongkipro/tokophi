-- A create-bill request needs a durable local identity before the provider call starts. Existing
-- payment rows predate caller-provided request keys, so all four columns stay nullable and receive no
-- fabricated backfill. PostgreSQL permits multiple NULLs in this partial unique index; only new,
-- explicitly-keyed requests participate in idempotency.
-- The generated 0095 snapshot also catches up indexes already created by earlier hand-written
-- migrations; this SQL does not replay that unrelated history.
DO $$ BEGIN
  CREATE TYPE "public"."payment_request_state" AS ENUM('in_progress', 'accepted', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "request_key" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "request_state" "payment_request_state";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "request_error" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "request_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_store_request_key_unique"
  ON "payments" USING btree ("store_id", "request_key")
  WHERE "request_key" IS NOT NULL;