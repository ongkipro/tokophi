ALTER TABLE "invoices" ADD COLUMN "number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_unique" UNIQUE("number");