ALTER TABLE "invoices" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reff_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "trx_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "virtual_account" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_at" timestamp with time zone;