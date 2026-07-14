-- Without this column a "recovery rate" is a lie.
--
-- `recovered_at` is stamped when a session becomes an order. But a cart that sailed straight
-- through checkout and a cart that went quiet and was genuinely RESCUED both end up `pulih` — they
-- are indistinguishable after the fact. So "carts we saved ÷ carts abandoned" would silently count
-- every ordinary sale as a save, and report a recovery rate near 100% to a merchant who has never
-- recovered anything.
--
-- A number that looks real and is wrong is worse than no number. Stamp the moment a session is
-- judged abandoned, and the two become distinguishable:
--   rescued  = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL
--   straight = abandoned_at IS NULL     AND recovered_at IS NOT NULL
ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "abandoned_at" timestamp with time zone;--> statement-breakpoint

-- Backfill: anything already sitting in `ditinggal` was abandoned; we know it went quiet, and
-- `updated_at` is the last time anyone touched it — that IS when it went quiet.
UPDATE "checkout_sessions"
   SET "abandoned_at" = coalesce("updated_at", "created_at")
 WHERE "status" = 'ditinggal' AND "abandoned_at" IS NULL;
