ALTER TABLE "orders" ADD COLUMN "awb" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "courier" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ka_order_id" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_phone" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_address" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_kecamatan_id" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_kecamatan_name" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_kelurahan_id" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_kelurahan_name" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_lat" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "sender_lng" text;