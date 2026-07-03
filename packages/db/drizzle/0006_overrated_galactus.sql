ALTER TABLE "customer_segments" ADD COLUMN "growth" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "emoji" text;