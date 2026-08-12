# ADR 0014 — The platform absorbs the courier's shipping cost on COD orders

**Status:** superseded by ADR 0015 · **Date:** 2026-08-05 · **Superseded:** 2026-08-12

## Historical decision

This ADR deliberately credited the Seller with the gross payment, including buyer-paid shipping,
while TokoΦ settled the courier from platform float. It was pinned because changing Seller proceeds
is a commercial decision rather than a refactor.

## Supersession

The owner decision in issue #180 replaces the gross-credit rule for prepaid and COD orders:

- Seller-withdrawable proceeds contain merchandise proceeds only.
- Buyer-paid shipping, gateway fees, COD fees, COD-fee VAT, and sales-tax liabilities never enter
  Seller balance.
- A courier cost above buyer-paid shipping is Seller-funded and recorded as an append-only,
  order-linked adjustment.
- A cheaper courier booking creates platform shipping margin.
- An accepted booking debit survives cancellation/return unless the provider confirms a void/refund.

ADR 0015 defines the replacement calculation, historical compatibility, and cutover constraints.
