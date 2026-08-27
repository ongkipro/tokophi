# FINANCE — the one map of TokoΦ money

> Owner rulings 2026-08-24. This file is the summary; the CODE and its tests are the truth.
> The human-readable **price card** (langganan, tabel biaya admin, aturan pencairan) is
> [`PRICING.md`](./PRICING.md) — same numbers, merchant/ops-facing; change prices in code+tests
> first, then both documents follow.
> Engines: `packages/lib/src/billing.ts` (subscription) · `packages/lib/src/payment-fees.ts`
> (gateway fee schedule) · `packages/lib/src/order-finance.ts` (order money) ·
> `apps/admin/lib/ledger-credit.ts` (what the seller can withdraw).
> Boundary: `/api/public/order` prices every order server-side; `checkout.astro` only mirrors it.

## 1. Subscription (platform ← seller)

- One plan. **Prices are the DPP (ex-tax)**: trial 3 days → Rp50rb first month → **Rp275rb/mo**
  (annual Rp2.7jt, 13 months from trial).
- **PPN 11% on the subscription is a GLOBAL toggle** — `platform_finance.subscription_ppn_enabled`
  (single row `id=1`, migration `0101`), switched in Super Admin → Pengaturan → **Keuangan**.
  Per-tenant PPN does **not** exist and must not be built.
  - **DEFAULT OFF at launch** (owner ruling): sellers pay the flat DPP — Rp275.000, no tax line.
  - Flipping it applies to the **next invoice** of every store, new or running. It never rewrites
    an issued invoice.
- `subscriptionCharge(base, ppnEnabled)` (`@tokophi/lib/billing`) is the ONE charge function. All
  **three invoice creators** read the toggle at creation time and store BOTH numbers on the invoice
  (`invoices.amount_idr` = billed total, `invoices.tax_idr` = the PPN actually added, 0 when off):
  1. billing cron — `apps/admin/app/api/cron/billing/route.ts`
  2. merchant pay flow — `apps/admin/lib/actions/billing.ts` (`createSubscriptionPayment`)
  3. super-admin manual invoice — `apps/super-admin/lib/actions.ts` (`createManualInvoice`)
- **The faktur renders the STORED `tax_idr`, never a derived one** (`app/faktur/[number]/page.tsx`):
  an invoice billed with the toggle off must not display invented PPN. Display sites
  (`/akun/langganan`, the pay widget) read the same toggle so the number on screen equals the
  number that will be billed.
- Guards: `packages/lib/src/billing.test.ts` → `subscriptionCharge`.

## 2. Order money (buyer → platform → seller)

`calculateOrderFinance` (`@tokophi/lib/order-finance`) is the canonical, immutable calculation; its
output is frozen into `order_financials` at order creation.

**The split (owner ruling):**

> **The seller receives GOODS OMSET + GOODS PPN. Shipping fees and payment-admin fees are
> platform money.**

- `omset` = goods after goods-discount (`subtotal − goodsDiscount`).
- Goods PPN (the seller's own `tax_enabled` setting) goes **with the seller** — they remit it.
  - *Inclusive* mode: the sticker price already contains it → it is inside `goods_proceeds_idr`.
  - *Exclusive* mode: charged as a separate line on top → credited to the seller as
    `salesTaxAddedIdr`.
  - Both modes land the seller on the same all-in goods figure.
- `sellerEntitlementIdr = goodsProceeds + salesTaxAdded − sellerShippingDebit` (the debit is the
  merchant-absorbed gap when actual courier cost exceeds what the buyer was charged).
- Shipping charged to the buyer, any shipping margin, the COD fee (+ its VAT), and every gateway
  fee **never** enter seller proceeds.

## 3. Payment-admin fee schedule (buyer → platform)

`PAYMENT_FEES` + `CHANNEL_FEE_OVERRIDES` (`@tokophi/lib/payment-fees`). ⚠️ Since 2026-08-24 these
are **ENFORCED in checkout pricing** (server: `/api/public/order`; mirror: `checkout.astro`) — the
old "display only" note is dead.

| Method | Fee | Base |
|---|---|---|
| **COD** | **3%**, then **PPN 11% on the fee** | goods omset + shipping charged |
| **QRIS** | **0,7%** | goods **omset** (never the payable) |
| **VA BCA** (`VABCA`) | **Rp6.500** flat | — |
| **VA other banks** | **Rp3.500** flat | — |
| E-Wallet | 2,4% | payable |
| Minimarket/retail | Rp4.000 flat | — |

- **`base` is part of a fee's identity.** A pct fee without a declared base is how QRIS was 1% of
  the payable for months. Server passes BOTH candidate bases; the schedule entry decides which is
  read. The client mirror reads `data-fee-base` — neither side may hardcode a denominator.
- **VA is per-BANK via the channel code** (`platform_payment_channels.channel`), so adding a bank
  with its own price is a data edit in `CHANNEL_FEE_OVERRIDES`, not new logic.
- **COD is not in the gateway table**: it changes the ORDER total, so it lives inside
  `calculateOrderFinance` (straight 3% — the old gross-up `×0.03/0.97` is dead).
- **NO TAX-ON-TAX**: the goods PPN line is **outside every fee base**. Fee-ing the PPN would charge
  admin over money that belongs to the state via the seller.
- Fees are shown to the shopper at `/checkout` per selected method; labels stay white-label
  (no PSP/courier brand — ADR 0004).

### Worked example — exclusive-PPN store, COD

Goods (after discount) Rp100.000 · seller PPN 11% exclusive · ongkir Rp20.000:

```
Buyer pays : 100.000 goods + 11.000 PPN + 20.000 ongkir
           + COD fee 3% × (100.000 + 20.000) = 3.600, + PPN 11% atas fee = 396
           = Rp134.996 total
Seller gets: 100.000 + 11.000 = Rp111.000   (remits the 11.000 PPN)
Platform   : 20.000 ongkir (vs courier cost) + 3.600 COD fee (+ remits the 396 fee-PPN)
```

Same store on QRIS: fee = 0,7% × 100.000 = Rp700 (the 11.000 PPN and the ongkir are NOT in the
base). On VA BCA: flat Rp6.500 whatever the amounts.

## 4. The ledger (what the seller can withdraw)

- `creditSaleForPayment` books `goods_proceeds_idr + (orders.tax_idr − included_sales_tax_idr)` —
  omset plus the ADDED goods PPN, derived from stored facts, never recomputed. Inclusive stores get
  no add-back (the expression cancels). **LEGACY orders (no `order_financials`) credit
  `greatest(subtotal − discount, 0)` — goods only, from the order's own columns** (0104; the old
  `payments.amount_idr` fallback contained shipping — owner report 2026-08-24 — and existing rows
  were corrected by `ops/tokophi-legacy-credit-correction.sql`). The view uses the same legacy
  expression, so reports and the balance cannot disagree.
- Claw-backs reverse the **sale entry's own amount** (`−l.amount_idr`), so they stay symmetric with
  whatever formula credited it.
- Release/payout rules unchanged (`platform_payout.release_on`, CAS payout transitions).
- Payouts are settled **manually by the Super Admin** (Pencairan → Proses → Tandai lunas). The
  "Tandai lunas" dialog takes an optional **bank-transfer reference**, written in the same CAS
  statement as the status flip. `payouts.note` is keyed by terminal status: `gagal` ⇒ rejection
  reason, `selesai` ⇒ transfer reference; both render on the merchant's `/saldo` Penarikan rows
  (and the CSV export's `Keterangan` column), so both sides can reconcile against the bank statement.

## 5. Guards

- `packages/lib/src/order-finance.test.ts` — COD 3%+VAT pin, seller-gets-PPN both modes, no
  tax-on-tax.
- `packages/lib/src/payment-fees.test.ts` — per-bank VA flats, QRIS omset base, base-field
  authority, no negative fee.
- `packages/lib/src/billing.test.ts` — `subscriptionCharge` on/off.
- `apps/admin/lib/ledger-credit.test.ts` — added-PPN credit, inclusive no-double-credit, plus the
  standing sale/claw-back suite (real Postgres).

**If this file disagrees with the code, the code wins — and this file is a bug. Fix it.**
