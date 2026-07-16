-- ─────────────────────────────────────────────────────────────────────────────
-- 0052 — every order number becomes `PHI-…`.
--
-- Orders were minted by THREE generators with three prefixes: `WEB-` (/api/public/order),
-- `INV-` (seed, the demo store) and `ORD-` (seed, the other stores). One entity, three badges.
--
-- Worse, `INV-` was shared with subscription INVOICES (`invoices.number` = INV-9006), so
-- `INV-4517` was an order and `INV-9006` a bill — different objects, same prefix. Orders move to
-- `PHI-`; invoices keep `INV-`, and the collision is gone.
--
-- Safe to rename in place, verified against production before writing this:
--   · nothing outside `orders` refers to a number — 0 AWBs (no courier ever booked one), 0 rows in
--     platform_activity / support_messages / conversation_messages mention one;
--   · no suffix appears under two prefixes, so PHI-<suffix> cannot collide with itself
--     (ORD-8000..8014, INV-4765..4821, WEB-020451793..202951778F2Y — disjoint);
--   · `orders.number` is UNIQUE, so a collision would abort this transaction rather than corrupt.
-- Done now precisely because nothing is public yet: after launch a buyer, a courier and an invoice
-- all hold this string, and renaming it stops being a migration and starts being a broken promise.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE orders
SET number = 'PHI-' || substring(number from position('-' in number) + 1)
WHERE number ~ '^(WEB|INV|ORD)-';
