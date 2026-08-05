# ADR 0014 — The platform absorbs the courier's shipping cost on COD orders

**Status:** accepted · **Date:** 2026-08-05 · **Decided by:** the owner · **Supersedes:** nothing
**Implements:** N42 · **Related:** ADR 0004 (platform-managed payments & shipping), `KIRIMINAJA.md` §6

## Context

A COD order collects cash at the door. The courier takes the full order total from the buyer —
`subtotal + ongkir + pajak − diskon`, the same number `createShipment` tells KiriminAja to collect —
and remits it to us **net of the shipping cost it keeps** (and of any COD fee).

The ledger credits the merchant `payments.amount_idr`, which for a COD order is that **gross** total.
So the merchant's `available` balance is larger than the cash that actually reached us, by the
shipping cost, on every delivered COD order. The difference comes out of the platform's own float
when the merchant withdraws.

This was found during the KiriminAja doc sweep (2026-08-05) and filed rather than fixed, because
"correcting" it would change what merchants are owed — a commercial decision, not a defect.

## Decision

**The platform absorbs the courier's shipping cost on COD orders.** The merchant is credited the
gross order total, including the ongkir the buyer paid, and the platform settles the courier.

## Consequences

### The gross credit is now DELIBERATE. Do not "fix" it.

`creditSaleForPayment` books `payments.amount_idr` — the full total — and that is correct under this
ADR. It **looks** like the classic bug where a cost is forgotten, and a future audit will find it
again. **It is pinned by `apps/admin/lib/cod-shipping-cost.test.ts`**, which fails with this ADR
named if anyone starts netting the shipping cost out of a COD merchant's credit. Change the ADR
first, then the test, then the code — in that order.

### The cost is real and must be visible

Absorbing a cost is not the same as ignoring it. It scales linearly with COD volume, and COD is the
rail we push hardest (SPX is both the primary courier and the only COD-capable one). It is now
reported to Super Admin — "Ongkir COD ditanggung" on `/analitik`, read from
`orders.ka_shipping_cost_idr`.

### We can only report what we recorded

`orders.ka_shipping_cost_idr` arrived with **migration 0088** (2026-08-05). Every order booked before
it has `NULL`, which means *not recorded* — **never zero**. The report counts those orders separately
and says how many; a cost figure that silently treats unknown as nil would understate exactly the
history it is meant to expose.

### The COD fee is NOT included, and cannot be

KiriminAja documents no COD settlement fee — no endpoint, no schedule, no webhook (`KIRIMINAJA.md`
§6). `platform_cod.fee_pct` exists in the schema and is **read by nothing** (only ever seeded to `0`).
So the reported figure is the **shipping cost only**, and the real absorbed amount is that much *or
more*. The screen says so. Do not present it as a complete cost of COD.

## Non-COD is the same shape, and is NOT decided here

A prepaid order runs the same way: the shopper pays online, the platform receives it, the merchant is
credited the gross, and the platform settles the courier — by VA rather than by netting (see
`apps/admin/lib/shipment-payment.ts`, the one place that separates the two flows). So the platform
absorbs prepaid shipping too, by the same mechanics and today by the same silence.

**This ADR does not decide that.** The report shows both flows side by side precisely so the prepaid
number stops being invisible while a decision is made. If the answer differs from COD's, it needs its
own ADR.

## Alternatives rejected

- **Net the shipping cost out of the merchant's credit.** Rejected by the owner. It would also mean a
  merchant's payout depends on a courier invoice we cannot yet read back (the Payment endpoint's path
  is not in the captured docs).
- **A `cost` kind in `ledger_entries`.** Rejected on structure, not on effort: `ledger_entries` is the
  **merchant's** book and is store-scoped. A platform cost booked there would move merchant balances —
  the exact outcome this ADR rejects. The platform's cost is derivable from
  `orders.ka_shipping_cost_idr`, so it needs a query, not a table.
