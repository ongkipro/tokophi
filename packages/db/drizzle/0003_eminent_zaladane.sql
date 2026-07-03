ALTER TABLE "collections" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "emoji" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "units_sold" integer DEFAULT 0 NOT NULL;