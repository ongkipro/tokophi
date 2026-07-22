-- form_config — which optional order-form elements a landing shows (email / quantity / trustBadges /
-- summary). Applies to both landing kinds; the 4 core COD fields are always shown. Nullable-by-default
-- so existing rows keep the built-in defaults.
ALTER TABLE "promo_pages" ADD COLUMN IF NOT EXISTS "form_config" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "landing_pages" ADD COLUMN IF NOT EXISTS "form_config" jsonb DEFAULT '{}'::jsonb NOT NULL;
