-- Owner ruling 2026-08-24: advanced matching is ALWAYS ON — the per-channel toggle is gone from the
-- Seller UI and nothing reads the column anymore (storefront + CAPI attach hashed identifiers
-- unconditionally). The column stays (dropping is destructive); default flips to true and existing
-- rows converge so the record matches the behaviour. Idempotent.
ALTER TABLE "store_tracking_channels" ALTER COLUMN "advanced_matching" SET DEFAULT true;
UPDATE "store_tracking_channels" SET "advanced_matching" = true WHERE "advanced_matching" = false;
