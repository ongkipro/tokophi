ALTER TABLE "orders" ADD COLUMN "ship_kelurahan_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_kelurahan_name" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_zip" text;