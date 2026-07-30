ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "promo_hub_title" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "promo_hub_subtitle" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "promo_hub_banner_url" text;