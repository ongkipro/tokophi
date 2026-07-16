-- ─────────────────────────────────────────────────────────────────────────────
-- 0053 — orders remember WHICH SERVICE was bought, not just which courier.
--
-- `orders.courier` (added by d562ee2) says "spx". It does not say WHICH spx: SPX Standard (type 1,
-- group `regular`) and SPX Economy (type 3, group `economy`) are different products at different
-- prices. `/api/public/order` already knows — it matches the fresh quote on courier+service_type and
-- then throws the service_type away. Same omission `courier` had, one level down.
--
-- Two things need it:
--   · booking from the admin cannot auto-pick the service the SHOPPER paid for while it only knows
--     the courier — with two spx services it would be a coin flip on the buyer's money;
--   · the "1 day / reguler / ekonomi / cargo" filter is `platform_couriers.services[].group`, which
--     is reachable only via the service type. Today it is unjoinable, so the filter cannot exist.
--
-- BACKFILL — these are DUMMY values, and that is a deliberate, temporary licence.
-- Nothing here is public yet (0 AWBs, no courier has ever been booked, no buyer holds a number), so
-- the 67 demo orders that carry NO courier at all are seed fiction either way; giving them a
-- plausible courier+service makes the demo coherent and gives the group filter something to filter.
-- ⚠️ This is safe ONLY pre-launch. Once a shopper picks a service, inventing one is fabricating what
-- they chose — the same class of lie as the hardcoded `badge: "7"`. Never rerun this on live data.
--
-- The backfill obeys the platform's own COD rule (lib/cod.ts): a COD order may only ride SPX, the
-- single courier with `codAllowed: true`. So COD orders keep spx and get an spx service; everything
-- else is spread across the enabled non-COD services, deterministically by order number so a rerun
-- lands identically.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN service_type text;

-- 1) COD → SPX Standard (type 1). COD is locked to SPX by policy; Standard is the default of the two.
UPDATE orders o
SET service_type = '1', courier = 'spx'
WHERE o.service_type IS NULL
  AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.method = 'cod');

-- 2) Already has a courier (non-COD) → that courier's `regular` service.
UPDATE orders o
SET service_type = s->>'type'
FROM platform_couriers c, jsonb_array_elements(c.services) s
WHERE o.service_type IS NULL
  AND o.courier IS NOT NULL
  AND o.courier = c.courier
  AND s->>'group' = 'regular';

-- 3) No courier at all (the 67 seed dummies) → spread across enabled non-COD services.
WITH pool AS (
  SELECT row_number() OVER (ORDER BY c.courier, s->>'type') - 1 AS i,
         c.courier AS courier,
         s->>'type' AS type
  FROM platform_couriers c, jsonb_array_elements(c.services) s
  WHERE c.enabled AND (s->>'codAllowed')::boolean IS NOT TRUE
),
tgt AS (
  SELECT id, row_number() OVER (ORDER BY number) - 1 AS r
  FROM orders
  WHERE courier IS NULL
)
UPDATE orders o
SET courier = p.courier, service_type = p.type
FROM tgt, pool p
WHERE o.id = tgt.id
  AND p.i = tgt.r % (SELECT count(*) FROM pool);
