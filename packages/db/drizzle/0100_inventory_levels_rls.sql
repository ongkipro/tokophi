-- Task 6.2 / F-T8 — DIRECT tenant isolation for `inventory_levels`.
--
-- Until now this table's ONLY tenant boundary was the application: every writer had to read its
-- RLS-protected parent inside the same transaction first (AGENTS.md, "THE CHILD-TABLE RULE"). That
-- rule has been broken and SHIPPED seven times, and `verify-rls` structurally cannot police it — it
-- derives its table list from `store_id` columns, and this table has none, so it was invisible to
-- the very check that exists to catch this.
--
-- ⚠️ NO DENORMALISED `store_id` COLUMN, deliberately (the task forbids one unless a policy cannot be
-- made safe and performant). It cannot be free either: a copied `store_id` is a second source of
-- truth that can disagree with the variant it belongs to, and nothing would notice. The ownership
-- chain is already in the row.
--
-- ONE HOP, NOT TWO: `product_variants` carries its own `store_id`, so this resolves by PRIMARY KEY
-- lookup — no join through `products`. The subquery is itself RLS-filtered when it runs as
-- `tokophi_app`, which is a second net; the explicit `store_id =` predicate is the rule, exactly as
-- AGENTS.md puts it ("The WHERE is the rule; the policy is only the net").
--
-- With no `app.store_id` GUC, `app_current_store_id()` is NULL, `v.store_id = NULL` is NULL, EXISTS
-- is false, and the table returns ZERO rows — the same fail-closed shape every other policy has.
--
-- ⚠️ USING AND WITH CHECK ARE DELIBERATELY DIFFERENT, and this is the one judgement in the file:
--   · USING  = the variant chain alone, so the store that owns the variant can always SEE and
--              DELETE a row referencing it. A stricter USING would make a mismatched row invisible
--              to everybody and therefore impossible to clean up through the app.
--   · WITH CHECK = variant chain AND location, so a row pairing this store's variant with ANOTHER
--              store's location cannot be CREATED in the first place. Refusing to write a
--              cross-store pairing is cheap; hiding one that already exists is not.
ALTER TABLE "inventory_levels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "inventory_levels";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_levels"
  USING (
    EXISTS (
      SELECT 1 FROM "product_variants" v
       WHERE v."id" = "inventory_levels"."variant_id"
         AND v."store_id" = app_current_store_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "product_variants" v
       WHERE v."id" = "inventory_levels"."variant_id"
         AND v."store_id" = app_current_store_id()
    )
    AND EXISTS (
      SELECT 1 FROM "locations" l
       WHERE l."id" = "inventory_levels"."location_id"
         AND l."store_id" = app_current_store_id()
    )
  );
