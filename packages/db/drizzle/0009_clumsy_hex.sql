ALTER TABLE "products" ADD COLUMN "sizes" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "badge" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bestseller" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rating_value" real;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;