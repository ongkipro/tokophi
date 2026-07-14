-- Courier roster: one shape, and only couriers that exist.
--
-- Two data faults, both of which reached (and broke) production today.
--
-- 1. `platform_couriers.services` held TWO DIFFERENT SHAPES in the same jsonb column:
--      legacy  ["Reguler", "YES"]                       ← old seed, copied from a hand-written list
--      current [{"type":"REG23","name":…,"group":…,     ← syncCouriersFromKiriminaja()
--                "cod":true,"codAllowed":false}, …]
--    Every reader now object-guards (`typeof s === "object"`), so a string row degrades to "this
--    courier has no services" — invisible, and it silently costs the merchant every service on that
--    courier. Worse, a `jsonb_set` over a string ELEMENT raises "cannot set path in scalar" and
--    aborts the whole UPDATE it sits in. A column with two shapes is a bug waiting for a writer.
--    → drop every non-object element. A legacy string carries no service_type, no group and no cod
--      flag; it cannot be upgraded into an object, only re-fetched (super-admin → Kurir → "Sync dari
--      KiriminAja"). Losing it is the point: it was never bookable.
--
-- 2. Phantom couriers. `tiki` and `pos` came from the same hand-written list. KiriminAja returns
--    NEITHER — verified 2026-07-14 against POST /api/mitra/v6.1/shipping_price (sandbox, Menteng →
--    Coblong, 1 kg): the live roster is exactly sicepat, jne, jnt, spx, anteraja, sap, lion, ninja,
--    idx, jtcargo. A phantom row is a switch in the super-admin that can be turned ON and then does
--    nothing: no rate ever comes back for it, so it cannot appear at checkout and cannot be booked.
--    → delete the rows, and any store_shipping_methods that reference a courier no longer on the
--      platform roster.
--
-- Deliberately NOT deleted: couriers KiriminAja stopped returning but that still have services and
-- history. The sync DISABLES those (it never deletes) precisely because old orders name them.
-- Only rows that are BOTH not-in-the-live-roster AND carry no usable service are removed here.

-- 1 — strip legacy string elements from services (leaves a valid, possibly empty, array)
UPDATE platform_couriers pc
SET services = COALESCE(
  (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(pc.services) AS elem
    WHERE jsonb_typeof(elem) = 'object' AND elem ? 'type'
  ),
  '[]'::jsonb
)
WHERE jsonb_typeof(services) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(pc.services) AS elem
    WHERE jsonb_typeof(elem) <> 'object' OR NOT (elem ? 'type')
  );

-- anything that was NULL or a bare scalar becomes an empty array, so every reader sees one shape
UPDATE platform_couriers SET services = '[]'::jsonb
WHERE services IS NULL OR jsonb_typeof(services) <> 'array';

-- 2 — phantom couriers KiriminAja does not carry
DELETE FROM store_shipping_methods WHERE courier IN ('tiki', 'pos');
DELETE FROM platform_couriers
WHERE courier IN ('tiki', 'pos')
  AND jsonb_array_length(COALESCE(services, '[]'::jsonb)) = 0;
