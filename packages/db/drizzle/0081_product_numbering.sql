-- 0081 — stable, system-generated catalog identity (ADR 0013).
--
-- WHY: every id we sent to Google/Meta/TikTok was derived from the product HANDLE — `handle`, or
-- `handle-{ordinal}` for a variant. All three providers key a catalog item by that id, and none of
-- them offers a re-key: change it and Google "overwrites your product and its history", Meta deletes
-- and recreates the item (taking every retargeting audience built on the old content_id with it).
-- Yet renaming a product, reordering variants, or simply ADDING A SECOND VARIANT changed it. Those are
-- one-click actions in the product editor.
--
-- ⚠️ ORDER MATTERS HERE. drizzle-kit generated the UNIQUE constraints before the backfill, which is
-- unappliable: every existing row would carry the column default (number=0, seq=1) at that moment and
-- collide. Columns → backfill → constraints, and each backfill is fenced so a re-run cannot renumber
-- live products (renumbering IS re-keying, i.e. the exact damage this migration exists to prevent).

CREATE TABLE IF NOT EXISTS "store_counters" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"product_next" integer DEFAULT 1001 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_counters" ADD CONSTRAINT "store_counters_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Columns, nullable first so the backfill can decide every value.
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "seq" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "number" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_seq_next" integer;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "catalog_id_scheme" text DEFAULT 'handle' NOT NULL;--> statement-breakpoint

-- Product numbers: per STORE, starting at 1001, ordered so a restored dump renumbers identically.
-- `unique(store_id, handle)` makes (created_at, handle) a total order — no uuid tiebreak needed.
UPDATE "products" p SET "number" = 1000 + x.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY store_id ORDER BY created_at, handle) AS n
  FROM "products"
) x
WHERE x.id = p.id AND p."number" IS NULL;--> statement-breakpoint

-- Variant seqs: `ORDER BY position, id` is byte-identical to the ordering the feed and the conversion
-- payload already used to derive today's `handle-{n}`. That is what makes the old→new id map computable
-- for a merchant who wants to reconcile their catalog after switching schemes.
UPDATE "product_variants" v SET "seq" = x.n
FROM (
  SELECT id, row_number() OVER (PARTITION BY product_id ORDER BY position, id) AS n
  FROM "product_variants"
) x
WHERE x.id = v.id AND v."seq" IS NULL;--> statement-breakpoint

-- High-water mark: one past the highest seq this product has ever had.
UPDATE "products" p SET "variant_seq_next" =
  coalesce((SELECT max(v."seq") FROM "product_variants" v WHERE v.product_id = p.id), 0) + 1
WHERE p."variant_seq_next" IS NULL;--> statement-breakpoint

-- Counters start above whatever the backfill handed out, so the next allocation cannot collide.
INSERT INTO "store_counters" ("store_id", "product_next")
SELECT s.id, coalesce((SELECT max(p."number") FROM "products" p WHERE p.store_id = s.id), 1000) + 1
FROM "stores" s
ON CONFLICT ("store_id") DO UPDATE
  SET product_next = greatest(excluded.product_next, store_counters.product_next);--> statement-breakpoint

-- Now the columns can be NOT NULL and unique.
-- NOT NULL and NO DEFAULT on the two identity columns: a default would let a future insert path forget
-- to allocate and quietly publish catalog id `0-1`, with the unique only catching the SECOND offender.
ALTER TABLE "product_variants" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "seq" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "number" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "variant_seq_next" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "variant_seq_next" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "product_variants_productId_seq_unique";--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_seq_unique" UNIQUE("product_id","seq");--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_storeId_number_unique";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_number_unique" UNIQUE("store_id","number");--> statement-breakpoint

-- RLS: `store_counters` is store-scoped, so `verify-rls` (which derives its set from the `store_id`
-- column) will REQUIRE this policy. The allocation runs under `tokophi_app` inside withTenant, so the
-- policy is also what stops one store allocating from another's counter.
ALTER TABLE "store_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "store_counters";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_counters" USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id());
