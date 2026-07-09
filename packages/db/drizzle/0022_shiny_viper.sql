ALTER TYPE "public"."store_status" ADD VALUE 'past_due' BEFORE 'suspended';--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "first_invoice_paid" boolean DEFAULT false NOT NULL;