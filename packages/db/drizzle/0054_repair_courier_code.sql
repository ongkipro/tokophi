-- ─────────────────────────────────────────────────────────────────────────────
-- 0054 — repair orders whose `courier` holds a service NAME instead of a courier CODE.
--
-- `createShipment` persisted `courier: input.serviceName` — so booking an order overwrote a perfectly
-- good code (`spx`) with a display string ("SPX Standard"). `orders.courier` is a JOIN KEY: to
-- platform_couriers (which carries `codAllowed` for the COD policy, and the `group` behind the
-- 1 day / reguler / ekonomi / cargo filter) and to the per-courier COD return report. "SPX Standard"
-- matches nothing, so every booked order silently dropped out of all of them — the corruption was
-- invisible precisely because a booked order is the one you stop looking at.
--
-- Found in production the first time a booking ever succeeded: two rows, one of them incoherent —
-- courier "SAP Satria Reg" carrying JNE's service type REG23, because the name was written while
-- service_type was left behind. The code is fixed in the same commit; this repairs the rows.
--
-- Generic on purpose: it resolves ANY courier value that matches a service `name` back to that
-- service's courier code AND its real type, straight from platform_couriers. No hardcoded order
-- numbers — if a third row is corrupted tomorrow by an older image still in flight, this heals it too.
-- Rows already holding a valid code are untouched (the join is on `name`, not on the code).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE orders o
SET courier = m.code,
    service_type = m.type
FROM (
  SELECT c.courier AS code, s->>'name' AS name, s->>'type' AS type
  FROM platform_couriers c, jsonb_array_elements(c.services) s
) m
WHERE o.courier = m.name
  AND o.courier <> m.code;
