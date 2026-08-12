# ADR 0015 — Net Seller proceeds and shipping reconciliation

**Status:** accepted · **Date:** 2026-08-12 · **Decided by:** the owner in issue #180  
**Supersedes:** ADR 0014 · **Related:** ADR 0004

## Decision

One immutable checkout allocation and one append-only Seller ledger govern prepaid and COD orders.
Seller-withdrawable proceeds are merchandise proceeds only. Shipping, gateway fees, COD fees,
COD-fee VAT, and sales-tax liabilities are platform-controlled money and never enter Seller balance.

```text
goods_proceeds          = subtotal - goods_discount - included_sales_tax
shipping_charged        = checkout_shipping - shipping_discount
shipping_delta          = booked_shipping - shipping_charged
seller_shipping_debit   = max(0, shipping_delta)
platform_shipping_margin = max(0, -shipping_delta)
seller_entitlement      = goods_proceeds - seller_shipping_debit
```

Store-owned goods and shipping discounts are persisted separately. A future platform-funded
promotion requires an explicit funding source; it must not be inferred from copy or a discount name.

For COD, where `B` is the buyer's merchandise, added sales tax, and shipping payable after discounts:

```text
cod_fee_before_vat = round(B × 0.03 / 0.97)
cod_fee_vat        = round(cod_fee_before_vat × 0.11)
buyer_cod_total    = B + cod_fee_before_vat + cod_fee_vat
```

Integer IDR uses `Math.round`, pinned by table-driven tests.

## Booking and ledger invariants

- The booking service is live-priced on the server. A browser-posted cost is only compared to detect
  that the confirmation became stale; it is never the authoritative amount.
- Before the provider call, the order and store money path are serialized. The surcharge is reserved
  in append-only ledger adjustments. The same per-store advisory lock serializes payouts.
- The order-funded portion remains pending with the order proceeds. Any excess is debited from
  available Seller balance. Booking is refused before the provider call when that balance is short.
- A prepaid order cannot reserve or book shipping before a successful payment exists. COD remains
  bookable while its payment is pending because collection occurs at delivery.
- A transport failure is an unknown outcome, not a provider rejection. The stable provider reference
  and reserved debit remain active, and blind rebooking is blocked until reconciliation.
- A failed provider response appends opposing reservation entries. A cancellation acceptance only
  records `cancellation_requested`; it preserves the AWB, provider identity, and debit. Opposing debit
  entries require separate provider confirmation that the booking cost was voided or refunded.
- Rebooking creates a new immutable booking record only after the prior booking is confirmed voided.

## Payment invariants

- AutoLaris `amount`, `admin`, and `total` are authoritative for the created bill and are persisted.
- The configured fee schedule is disclosed before confirmation. A difference from the provider
  response is a reconciliation signal, never a Seller-balance adjustment.
- QR payloads remain persisted as text. Presentation uses a server-generated QR image plus an
  accessible, copyable text fallback.
- Prepaid collection and COD delivery both create at most one merchandise sale credit. Returns and
  cancellations reverse the merchandise credit once; accepted shipping debits remain.
- A gateway-start failure is a partial failure: the order remains recorded, the checkout session
  becomes its idempotency key, and the shopper is told not to create a second order. It is never
  rendered as payment success.

## Historical compatibility and rollout

Legacy orders have only combined `orders.discount_idr`; goods and shipping funding cannot be
reconstructed safely. Migration 0094 therefore does not fabricate `order_financials` rows or rewrite
historical ledger entries. Compatibility reads retain historical gross credits and label those orders
as legacy/unallocated. Any production backfill requires a reviewed per-order allocation report and
separate owner approval.

The schema and readers are backward-compatible while migration 0094 rolls out. New net-ledger
semantics become active only for orders carrying an immutable `order_financials` snapshot.

Production rollout remains blocked until at least one KiriminAja sandbox settlement confirms the
COD fee base and IDR rounding against the immutable snapshot. Running that external booking requires
separate owner approval.
