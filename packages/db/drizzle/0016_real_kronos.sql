ALTER TYPE "public"."gateway_provider" ADD VALUE 'autolaris';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "store_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reff_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "trx_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "channel_code" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "admin_fee" bigint DEFAULT 0;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "total" bigint DEFAULT 0;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "virtual_account" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "qr" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payment_code" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
