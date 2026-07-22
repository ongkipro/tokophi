-- promo_pages.content — long-form AI-generated sales sections (problem/agitation/solution/guarantee),
-- a single typed jsonb blob so new section kinds don't each need a column. Nullable-by-default: a
-- landing with only the hero fields still renders. Store-scoped table already under RLS (0065).
ALTER TABLE "promo_pages" ADD COLUMN IF NOT EXISTS "content" jsonb DEFAULT '{}'::jsonb NOT NULL;
