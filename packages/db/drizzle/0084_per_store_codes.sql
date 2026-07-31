-- Voucher codes and purchase-order codes are unique PER STORE, not across the whole platform.
--
-- Both columns carried a bare `UNIQUE (code)`, which on a multi-tenant platform means the FIRST
-- merchant to use a string owns it forever:
--
--   · `discounts.code` — Indonesian promo codes collide constantly (GAJIAN, DISKON10, GRATISONGKIR).
--     One shop registering `GAJIAN25` permanently blocked every other shop, present and future. Worse,
--     the rejection told the second merchant the code was taken, which is a working way to probe which
--     codes a competitor is running.
--   · `purchase_orders.code` — generated as `PO-${Date.now().toString().slice(-6)}`, i.e. the last six
--     digits of the epoch in ms. That repeats every 10^6 ms ≈ 16.7 minutes, GLOBALLY. So two purchase
--     orders created anywhere on the platform at the same point in that cycle collide and the second
--     one simply fails to save. With eight stores it is a matter of time, and the merchant sees a
--     generic error about their own PO.
--
-- Reads were already store-scoped in both cases (`lib/promo.ts` filters on `store_id`, purchases run
-- under RLS), so nothing depended on the global scope — it was only ever a constraint, never a lookup.
--
-- SAFE BY CONSTRUCTION: this RELAXES a constraint. Every row that satisfied `UNIQUE (code)` also
-- satisfies `UNIQUE (store_id, code)`, so no existing data can block it. Verified before writing:
-- 0 conflicting groups in either table.
--
-- Idempotent, because the deploy runs `drizzle-kit migrate` and a half-applied migration must be
-- re-runnable: DROP uses IF EXISTS, and each ADD is guarded on pg_constraint.

ALTER TABLE "discounts" DROP CONSTRAINT IF EXISTS "discounts_code_unique";
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_code_unique";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discounts_store_code_unique') THEN
    ALTER TABLE "discounts" ADD CONSTRAINT "discounts_store_code_unique" UNIQUE ("store_id", "code");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_store_code_unique') THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_store_code_unique" UNIQUE ("store_id", "code");
  END IF;
END $$;
