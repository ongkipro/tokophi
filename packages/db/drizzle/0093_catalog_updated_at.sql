-- N13 — <lastmod> for products & categories needs a column that moves when the row changes.
-- NULLABLE, NO DEFAULT, NO BACKFILL, deliberately: default-now() would stamp migration day onto
-- every existing row as if it had just changed, and a backfill UPDATE would overwrite real values
-- if this batch ever re-runs. Readers coalesce with created_at (products) or omit lastmod
-- (collections, which have no created_at). Idempotent per this repo's standing migration rule.
--
-- ⚠️ The 0093 SNAPSHOT (meta/0093_snapshot.json) intentionally carries MORE than this file: drizzle
-- snapshots had not been regenerated since ~0083 (later migrations were hand-written), so the
-- snapshot is a catch-up to the real schema. This SQL applies ONLY the two columns below.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
