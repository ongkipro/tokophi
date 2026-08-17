# End-to-end order, shipping, COD, payment-fee, seller-ledger, and QRIS reconciliation

**Status:** implemented and deployed through PR #272 on 2026-08-12; provider settlement evidence remains explicitly unverified

**Implementation owner:** [`@irwansyah10`](https://github.com/irwansyah10)

**Tracking issue:** [#180](https://github.com/ongkipro/tokophi/issues/180)

> **Closed implementation contract, not an active queue.** The pre-implementation observations below
> explain the change but are no longer current behavior. Canonical runtime truth is code and migration
> `0094_magical_salo`; [ADR 0015](../../decisions/0015-net-seller-proceeds-and-shipping-reconciliation.md)
> owns the accepted money model; [`CHANGELOG.md`](../../../CHANGELOG.md#2026-08-12--order-finance-now-has-one-immutable-allocation-and-one-seller-entitlement)
> records the deployed result and remaining evidence boundary.

## Why this is one task

Order processing, courier booking, payment collection, and seller balance currently cross the same transaction but do not share one money model. Fixing only one screen would leave the ledger, KiriminAja booking, AutoLaris callback, COD collection, and buyer invoice disagreeing.

This task owns the complete path:

`checkout → order created → payment pending/paid → seller processes → shipping selected/changed → KiriminAja booking → pickup/tracking → delivered/returned → seller ledger/reconciliation`

## Evidence and decisions

### Observed

- `orders.shipping_idr` stores the shipping amount charged to the buyer at checkout.
- `orders.ka_shipping_cost_idr` stores the courier cost selected when the seller books KiriminAja. The two values may differ, but the difference currently moves no money.
- `createShipment()` allows the seller to book a different service from the checkout selection and then records the selected courier/service/cost.
- `creditSaleForPayment()` currently credits `payments.amount_idr`, which is the gross order amount including shipping. ADR 0014 explicitly preserves that old behavior.
- AutoLaris returns `amount`, `admin`, and `total`; `payments.admin_fee` and `payments.total` persist them.
- The buyer success page renders the raw AutoLaris QRIS payload as text. The repository already has a working server-side QR pattern using `QRCode.toDataURL()` in `apps/admin/lib/actions/billing.ts`.
- COD is collected only when the order reaches `selesai`; prepaid money is collected through the AutoLaris callback. Both paths already use idempotent payment/ledger guards.

### Owner decisions — normative for this task

1. The seller receives only net merchandise proceeds. Buyer-paid shipping is platform-controlled money and must never become withdrawable seller balance.
2. Payment-gateway fees are borne by the buyer. They must not reduce seller proceeds.
3. The checkout shipping price remains the buyer's shipping charge even when the seller chooses another service later.
4. If the final booked shipping cost is cheaper than the checkout shipping charge, the difference belongs to TokoPhi and is not credited to the seller.
5. If the final booked shipping cost is more expensive, the difference is debited first from this order's seller proceeds, then from the seller's available balance. Refuse the external booking before calling KiriminAja when those funds cannot cover the difference; do not silently create platform exposure or an unexplained negative balance.
6. COD has a 3% fee whose base includes the merchandise, shipping, and the pre-VAT COD fee itself. Add 11% VAT to that COD fee. This VAT is fee VAT, separate from any store/product sales-tax setting.
7. This decision supersedes ADR 0014's gross-credit rule. Update/supersede the ADR and its pinning tests in the same PR; do not leave code and accepted architecture contradicting each other.
8. Existing store-owned shipping vouchers and automatic free-shipping rules are seller-funded. Therefore `shipping_charged` is the shipping amount the buyer actually pays after the shipping discount; the seller bears any courier cost above that amount. A future platform-funded promotion requires an explicit funding-source field and a separate decision—it must not be inferred from a discount name.
9. Once KiriminAja has accepted a booking, its seller shipping debit remains even if the order is later cancelled or returned, because the courier cost may already be incurred. Reverse it only when the provider confirms that the booking cost was voided/refunded. Any return-leg fee is a separate unknown cost and must not be invented from the forward rate.
10. `orders.tax_idr` and COD-fee VAT are non-withdrawable liabilities, not merchandise proceeds. This task does not make a legal/tax applicability determination; it only keeps those amounts out of seller balance and records them separately for reconciliation.

## Traceable requirements

`Closed` below means the accepted implementation contract was delivered and moved to ADR 0015; these rows are historical evidence, not active requirement declarations.

| ID | Status | Accountable owner | Testable statement | Acceptance evidence |
| --- | --- | --- | --- | --- |
| `PR-OF-01` | Closed | Product owner | Seller withdrawable proceeds contain merchandise proceeds only, minus seller-funded shipping debit; shipping, gateway fee, COD fee, and fee VAT never enter seller balance. | DB ledger matrix + saldo/browser evidence |
| `PR-OF-02` | Closed | Product owner | A server-priced shipping change produces one idempotent debit when more expensive and platform margin when cheaper. | Quote/rebook/concurrency tests |
| `PR-OF-03` | Closed | Product owner | The buyer bears the exact AutoLaris admin fee and sees it before/after payment creation. | Checkout + provider-response tests |
| `PR-OF-04` | Closed | Product owner | COD buyer total uses the self-inclusive 3% fee and 11% fee VAT formula below. | Pure calculation fixtures + provider reconciliation evidence |
| `PR-OF-05` | Closed | Product owner | Prepaid and COD order/payment/shipping transitions share one guarded, idempotent state machine. | DB state-transition matrix |
| `PR-OF-06` | Closed | Product owner | QRIS buyers receive a scannable, accessible QR image with exact fee and payable amount. | Browser and rendering tests |
| `PR-OF-07` | Closed | Product owner | Authorized users can reconcile order, provider, courier, and seller-ledger amounts without exposing secrets or cross-tenant data. | Reconciliation query + tenant tests |

Constraints: multi-tenant isolation, append-only ledger, integer IDR, provider idempotency, no external call inside a DB transaction, no production write without owner approval.

## Canonical calculations

Use integer IDR and one shared pure calculator. Do not duplicate these formulas in UI, API, callback, or ledger code.

```text
goods_proceeds     = subtotal_idr - goods_discount_idr
shipping_charged   = orders.shipping_idr - shipping_discount_idr
shipping_actual    = orders.ka_shipping_cost_idr
shipping_delta     = shipping_actual - shipping_charged
seller_shipping_debit = max(0, shipping_delta)
platform_shipping_margin = max(0, -shipping_delta)
seller_entitlement = goods_proceeds - seller_shipping_debit
```

Shipping and goods discounts must be represented separately in the calculator. The existing combined `orders.discount_idr` is insufficient to reconstruct seller proceeds reliably; add an explicit persisted split or another immutable allocation that survives later promo edits.

COD formula, where `B = goods payable + shipping payable`:

```text
cod_fee_before_vat = round((0.03 / 0.97) * B)
cod_fee_vat        = round(0.11 * cod_fee_before_vat)
cod_fee_final      = cod_fee_before_vat + cod_fee_vat
buyer_cod_total    = B + cod_fee_final
```

The `0.03 / 0.97` form solves `fee = 3% × (B + fee)` and avoids a circular implementation. Pin the IDR rounding rule in tests. Before production rollout, reconcile at least one sandbox/provider fixture against KiriminAja's actual COD settlement; if the provider applies a different base or rounding rule, document the evidence and obtain owner approval before changing this decision.

Example without discounts or sales tax:

```text
goods = 100,000; checkout shipping = 20,000

Booked shipping = 15,000:
  seller entitlement = 100,000
  TokoPhi shipping margin = 5,000

Booked shipping = 30,000:
  shipping debit = 10,000
  seller entitlement = 90,000

COD on goods + shipping = 120,000:
  pre-VAT COD fee = round(120,000 × 0.03 / 0.97) = 3,711
  fee VAT = round(3,711 × 0.11) = 408
  final COD fee = 4,119
  buyer pays = 124,119
```

Store sales tax is outside the seller-shipping calculation and must remain separately accounted; do not silently put it into seller withdrawable proceeds or COD-fee revenue.

Cancellation/return rule:

```text
booking never accepted by provider     → no shipping debit
booking accepted, cost not refunded    → shipping debit remains
provider confirms cost void/refund     → append one reversing adjustment
parcel returned/refused                → reverse merchandise sale per current state machine;
                                         keep forward shipping debit; record any return fee separately
```

## Required implementation

### 1. One order state machine

- Preserve legal transitions and transaction boundaries in `lib/order-status.ts`.
- Prepaid orders: AutoLaris callback marks payment successful and creates one pending seller credit; duplicate callbacks create no second credit.
- COD orders: payment stays pending until verified delivery/`selesai`; cancellation or refusal creates no sale credit; return reverses an existing credit exactly once.
- `createShipment()` moves a valid order to `diproses`; KiriminAja pickup/tracking moves it to `dikirim`; verified delivery moves it to `selesai`.
- Do not mark a booking as shipped merely because KiriminAja returned a booking reference. AWB and pickup/tracking semantics remain distinct.

### 2. Shipping selection and editing

- On the order-detail shipping picker, show:
  - shipping paid by buyer;
  - newly selected courier cost;
  - difference;
  - who receives/pays the difference;
  - seller proceeds after the difference.
- Require an explicit confirmation before booking a different price/service.
- A shipment may be changed only before booking, or after the existing booking has been successfully cancelled/voided. Never mutate the financial terms of an in-transit, delivered, returned, or uncancellable booking.
- Re-fetch the live rate server-side and calculate the delta from server-owned order fields. Never trust a posted cost.
- Lock the order and relevant seller-ledger rows before reserving a surcharge. Refuse insufficient funds before the external KiriminAja call.
- If an external booking succeeds but the local transaction fails, retain enough provider identity for reconciliation; never create a second booking blindly.
- Rebooking must reverse/reconcile the previous shipping adjustment rather than stacking duplicate debits. The ledger remains append-only and idempotent.
- Do not overwrite away financial history. `ka_shipping_cost_idr` may represent the current booking, but every accepted booking/debit/reversal needs an immutable identity and audit trail.

### 3. Seller ledger and platform money

- Replace gross-order seller credits with merchandise-only entitlement.
- Buyer shipping, payment-gateway admin fee, COD fee, and COD-fee VAT must not enter seller-withdrawable balance.
- Represent an expensive shipping change as a signed, auditable, order-linked ledger adjustment with a uniqueness/idempotency constraint.
- A cheaper shipping change creates platform margin, not a positive seller entry.
- Dashboard revenue, order detail, saldo page, payout validation, exports, returns, cancellations, and reconciliation must all use the same seller-entitlement calculation.
- Existing historical rows must not be silently reinterpreted. Supply an idempotent migration/backfill plan and a report of affected orders before any production backfill.
- Payout validation must use the post-adjustment available balance and must never let a concurrent shipping debit race with a withdrawal.

### 4. Payment-gateway fee borne by buyer

- The checkout must disclose the payment fee before final confirmation using the enabled channel's current schedule.
- AutoLaris response fields `admin` and `total` are authoritative for the created bill; persist and render the exact values.
- Buyer payable for prepaid is the order payable plus gateway fee. Seller credit remains merchandise-only and is never reduced by the gateway fee.
- If configured fee and provider response disagree, surface a reconciliation signal; do not hide the difference in seller balance.
- Remove/disable seller/split fee-bearer choices for storefront transactions unless a separate owner decision restores them.

### 5. QRIS after checkout

- Fix `/checkout/sukses` so a QRIS payment displays a scannable QR image, not only the raw payload text.
- Reuse the existing server-side `qrcode` implementation pattern from `apps/admin/lib/actions/billing.ts`; avoid introducing another QR dependency.
- Keep the raw QR payload persisted, generate the image for presentation, and retain a copyable-text fallback.
- Render accessible alt text, sufficient white quiet-zone, a stable mobile size, expiry/payment amount, exact gateway admin fee, and exact total payable.
- Treat the QR payload as untrusted text: no raw HTML interpolation or executable URL handling.
- Refresh/recovery of the success page must not invent a QR or payment state when the order/payment cannot be recovered.

### 6. Reconciliation and observability

- Add a per-order financial breakdown visible to authorized seller/support users: goods proceeds, shipping charged, actual courier cost, shipping delta, gateway fee, COD fee, fee VAT, seller entitlement, ledger entries, payment state, KiriminAja booking/AWB, and reconciliation status.
- Log provider identifiers and state transitions, not secrets or full payment/customer payloads.
- Add a query/report for mismatches among order totals, payment totals, courier cost, seller entitlement, and ledger sum.

## Required tests

- Pure table-driven money tests for cheaper/equal/more-expensive shipping, discounts, gateway fee, COD self-inclusive 3% fee, 11% fee VAT, and IDR rounding.
- DB-backed ledger tests for prepaid callback retry, COD delivery, cancellation, return, cheaper shipping, expensive shipping, rebooking, and insufficient seller funds.
- Concurrency test: two booking attempts cannot double-book or double-debit.
- State-machine tests from `baru` through `diproses`, `dikirim`, `selesai`, `batal`, and `retur` for prepaid and COD.
- QRIS rendering test proves the buyer page contains a scannable image plus the exact amount/fee, with a text fallback when generation fails.
- Tenant-isolation and authorization tests: one seller cannot quote, book, edit, debit, or inspect another store's order.

## Delivery plan

This is a parent task. Implement it as reviewable dependent PRs rather than one high-risk money migration:

1. **`T-OF-01` / PR A — contract and calculator.** Primary: `PR-OF-01`. Constraints: `PR-OF-02`, `PR-OF-04`, `PR-OF-07`. Superseding ADR, immutable money breakdown, pure calculators, schema/migration, compatibility reads, and fixtures. No behavior switch.
2. **`T-OF-02` / PR B — buyer payment.** Primary: `PR-OF-03`. Constraints: `PR-OF-04`, `PR-OF-06`. Buyer-borne AutoLaris fee, QRIS image/fallback, checkout/success disclosure, and provider reconciliation.
3. **`T-OF-03` / PR C — shipping and seller ledger.** Primary: `PR-OF-02`. Constraints: `PR-OF-01`, `PR-OF-05`, `PR-OF-07`. Server-owned shipping delta, funding/debit reservation, booking/rebooking/void behavior, merchandise-only credit, payout locking, and ledger migration/backfill report.
4. **`T-OF-04` / PR D — state/E2E and observability.** Primary: `PR-OF-05`. Constraints: `PR-OF-04`, `PR-OF-06`, `PR-OF-07`. Full prepaid/COD transition matrix, reconciliation screen/query, safe logs, browser coverage, and sandbox run.

Each PR must remain backward-compatible with the currently deployed schema until its migration has finished. Do not enable the new ledger semantics before code, migration, and reconciliation checks are deployed together behind an explicit switch or safe cutover gate.

## Done when

- Every dependent PR links this issue and its primary `PR-OF-*` requirement; all four delivery phases are merged.
- `npm test`, admin TypeScript, targeted ESLint, storefront checks, and relevant DB-required tests pass.
- Browser verification covers desktop and mobile for checkout, success/QRIS, seller order detail, shipping change confirmation, order progression, saldo, and return/cancel paths.
- A sandbox end-to-end run records only safe identifiers and proves: checkout → payment/COD → shipping selection/change → booking → tracking status → final ledger outcome.
- No production migration, backfill, real payment, COD booking, or deployment is performed without separate owner approval.

## Primary code map

- `apps/admin/app/api/public/order/route.ts`
- `apps/admin/app/api/public/pay/callback/route.ts`
- `apps/admin/lib/actions/shipping.ts`
- `apps/admin/lib/order-status.ts`
- `apps/admin/lib/ledger-credit.ts`
- `apps/admin/lib/shipment-payment.ts`
- `apps/admin/app/(admin)/pesanan/[id]/order-detail.tsx`
- `apps/storefront/src/pages/checkout.astro`
- `apps/storefront/src/pages/checkout/sukses.astro`
- `packages/lib/src/autolaris.ts`
- `packages/lib/src/payment-fees.ts`
- `packages/db/src/schema.ts`
- `specs/decisions/0004-platform-managed-payments-shipping.md`
- `specs/decisions/0014-platform-absorbs-cod-shipping.md`
