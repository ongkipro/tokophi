# FINANCE — the one map of TokoΦ money

> Owner rulings 2026-08-24. This file is the summary; the CODE and its tests are the truth.
> The human-readable **price card** (langganan, tabel biaya admin, aturan pencairan) is
> [`PRICING.md`](./PRICING.md) — same numbers, merchant/ops-facing; change prices in code+tests
> first, then both documents follow.
> Engines: `packages/lib/src/billing.ts` (subscription) · `packages/lib/src/payment-fees.ts`
> (gateway fee schedule) · `packages/lib/src/order-finance.ts` (order money) ·
> `apps/admin/lib/ledger-credit.ts` (what the seller can withdraw).
> Boundary: `/api/public/order` prices every order server-side; `checkout.astro` only mirrors it.

## 0. The money map — one line per flow (state after Finance Overhaul II, 2026-09-17)

Rewritten from the 2026-09-16 audit's §1 table (`specs/docs/tasks/2026-09-16-finance-pricing-audit.md`)
into the state the code is in after Tasks 8.24–8.31. Each row names the engine, where it is enforced,
where the figure is stored and where it is shown — so a number on a screen can be traced to a row.

| flow | engine (pure) | enforced at | stored in | shown on |
|---|---|---|---|---|
| Order total | `order-finance.ts` `calculateOrderFinance` | `/api/public/order` (server re-prices everything; `checkout.astro` mirrors) | `orders.{subtotal,shipping,tax,discount,total}_idr` + `order_financials` (frozen) | checkout summary, `/checkout/sukses`, order detail |
| COD fee | same — `max(Rp2.500, 3% × (omset + ongkir))` + PPN 11% on the fee (8.29) | same | `order_financials.cod_fee_*` — **inside `orders.total_idr`** | checkout "Biaya COD" + "PPN biaya COD" |
| Gateway fee (QRIS/VA/e-wallet/retail) | `payment-fees.ts` `paymentFee` (`base` is part of the fee) | **computed and BILLED by us** (8.25 a): `/api/public/order` and the seller re-bill `createOrderPayment` both submit `order payable + fee` via `alCreateOrder`; the provider's fee nets against settlement | `payments.{amount_idr, admin_fee, total}` — all ours; `order_financials.expected_gateway_fee_idr` | checkout "Biaya admin", `/checkout/sukses`, `/keuangan/rekonsiliasi` |
| Goods PPN | `tax.ts` `computeTax` (store `tax_enabled`, inclusive/exclusive) | order API | `orders.tax_idr`, `order_financials.included_sales_tax_idr` | checkout, order detail |
| Shipping | `shipping-quote.ts` (one price producer) → `createShipment` re-quotes; delta reconciled | booking | `shipment_bookings.{charged,actual,seller_debit,platform_margin}` + ledger `shipping-*-debit` | order detail "Cek Ongkir" refusal, `/saldo` |
| Seller entitlement | view `order_seller_entitlements` (0102/0104) = goods + added PPN − shipping debit | — | derived | `/keuangan`, `/keuangan/penghasilan` — **collected money only** (`financial_status='dibayar'`, 8.28) |
| Ledger | `ledger-credit.ts` (`sale` on `payments.berhasil`; COD at `selesai`; release at `platform_payout.release_on`; `retur`/`batal` claw back the sale entry) | `applyOrderStatusChange` → `settleOrderLedger` | `ledger_entries` (balance = Σ by status; 3 partial unique indexes) | `/saldo`, Super Admin float |
| Refund to the buyer (8.31) | `refund-transition.ts` (CAS `menunggu → diproses → selesai/gagal`, never the ledger) | `applyOrderStatusChange` on `batal`/`retur` writes one open row per `berhasil` non-COD payment, same txn as the claw-back | `refunds` (0112, partial unique `refunds_one_open_per_payment`) | order detail "Pengembalian dana", Super Admin `/pencairan` refund queue, dashboard "Refund ke pembeli" tile |
| Payout | `payout.ts` (min from `platform_payout` — Rp200.000 on production, advisory lock, negative `payout` entry at request) → Super Admin `processPayout` → `markPayoutPaidInTxn` (CAS `diproses→selesai`) → `rejectPayout` (exact reversal) | Super Admin | `payouts`, `ledger_entries` | `/saldo`, `/pencairan` |
| Subscription | `billing.ts` (`quote`, `computeBilling`, `subscriptionCharge`) | **ONE creator** `createSubscriptionInvoice` (`@tokophi/db/subscription-invoice`, 8.24) called by the billing cron · merchant `/akun/langganan` · Super Admin manual | `invoices.{amount,tax}_idr`, `stores.{trial_ends_at,current_period_end,first_invoice_paid,comped}` | `/akun/langganan`, `/faktur/[number]`, Super Admin `/`, `/toko/[id]` |
| Comp ("Gratiskan N bulan") | `comp-invoice.ts` — a Rp0 `dibayar` invoice with `kind='comp'` (0113, 8.26) | Super Admin `compStore` | `invoices` (partial unique `invoices_one_comp_per_grant`) | `/akun/langganan` as "Gratis"; **excluded from MRR / "Pelanggan berbayar"** (`subscription-kpi.ts`) |
| Demo money | `stores.is_demo` (0113, 8.27; the seed flags its anchor store) | every Super Admin KPI read in `data.ts` filters it out | `stores.is_demo` | nowhere on the platform dashboard — it is flagged, not purged |
| PPN on subscription | global toggle `platform_finance.subscription_ppn_enabled` (**OFF** on prod since 2026-08-24) | the one creator at creation time | stored `tax_idr` | faktur renders the stored figure only ✅ |

## 1. Subscription (platform ← seller)

- One plan. **Prices are the DPP (ex-tax)**: trial 3 days → Rp50rb first month → **Rp275rb/mo**
  (annual Rp2.7jt, 13 months from trial).
- **PPN 11% on the subscription is a GLOBAL toggle** — `platform_finance.subscription_ppn_enabled`
  (single row `id=1`, migration `0101`), switched in Super Admin → Pengaturan → **Keuangan**.
  Per-tenant PPN does **not** exist and must not be built.
  - **DEFAULT OFF at launch** (owner ruling): sellers pay the flat DPP — Rp275.000, no tax line.
  - Flipping it applies to the **next invoice** of every store, new or running. It never rewrites
    an issued invoice.
- `subscriptionCharge(base, ppnEnabled)` (`@tokophi/lib/billing`) is the ONE charge function, and
  **`createSubscriptionInvoice()` (`@tokophi/db/subscription-invoice`) is the ONE invoice creator**
  (Task 8.24, 2026-09-17). It reuses a pending `menunggu` invoice, reads the toggle at creation
  time, submits to the provider with `alCreateOrder` (fee netted — never `create_payment`, where the
  payer transfers `amount + admin` and the exact-amount gate in `pay/callback` would ignore the
  payment), names the store OWNER as payer, and stores BOTH numbers on the row
  (`invoices.amount_idr` = billed total, `invoices.tax_idr` = the PPN actually added, 0 when off).
  Three paths call it and none builds a bill of its own:
  1. billing cron — `apps/admin/app/api/cron/billing/route.ts` (`RENEWAL_CHANNEL = "VABCA"`; it
     used to send `"BCA"`, a bank nickname no provider knows, so no renewal invoice was ever written)
  2. merchant pay flow — `apps/admin/lib/actions/billing.ts` (`createSubscriptionPayment`)
  3. super-admin manual invoice — `apps/super-admin/lib/actions.ts` (`createManualInvoice`)
  Guard: `apps/admin/app/api/cron/billing/route.test.ts` (real Postgres, provider stubbed) — one
  invoice for a `past_due` store, reused on the next tick, none for comped/in-period, promo price
  when the first invoice was never paid; plus a source claim that the cron never calls
  `alCreatePayment` or inserts into `invoices` itself.
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

**Who collects the fee (Task 8.25, decision (a), 2026-09-17): WE do.** `/api/public/order` computes
the fee from this schedule, then bills the PSP via `alCreateOrder` (the `submit` endpoint) for
**`buyerPayableIdr` = order payable + our fee**, which the PSP treats as the grand total. The
provider's own fee (`admin` in its echo) **nets against our settlement** and is never added to what
the shopper pays. Consequences:
- The shopper pays **exactly the number shown at checkout**; the success page and the bill agree.
- `payments.amount_idr` = order payable · `payments.admin_fee` = OUR fee · `payments.total` =
  buyerPayable — all three written by us at insert, none by the provider.
- The paid callback matches `amount` against `payments.total` (or `amount_idr`), both ours.
- **Platform margin on a payment = our fee − the provider's fee.** QRIS is the tight one (ours
  0,7% of omset vs theirs 0,7% of the grand total — see the audit, F2).
- `providerFee` is echoed in the order response as evidence only; `feeMismatch` flags a provider
  grand total that differs from ours (should be impossible on `submit`, logged when it happens).
- Before this, `alCreatePayment` (`create_payment`) let the PROVIDER add its fee on top of our
  order total, so the shopper paid our prediction of their fee — wrong by design whenever the two
  schedules differ.

| Method | Fee | Base |
|---|---|---|
| **COD** | **3%, min Rp2.500**, then **PPN 11% on the fee** (`COD_FEE_RATE` / `COD_FEE_MIN_IDR`, Task 8.29) | goods omset + shipping charged |
| **QRIS** | **0,7%** | goods **omset** (never the payable) |
| **VA BCA** (`VABCA`) | **Rp6.500** flat | — |
| **VA other banks** | **Rp3.000** flat (diturunkan dari Rp3.500 — ruling owner 2026-09-10; `list_payment` menagih akun kita **Rp3.000 `fix`** untuk VABNI/VAPERMATA/VAMANDIRI/VABRI, diukur 2026-09-10, jadi Rp3.500 adalah **kelebihan tagih ke pembeli**, bukan margin) | — |
| E-Wallet | **3,0%** (dinaikkan dari 2,4% — ruling owner 2026-09-09, menyamakan dengan yang ditagih provider: `list_payment` melaporkan OVO 3,0% `persen`, diukur 2026-09-09) | payable |
| Minimarket/retail | Rp4.000 flat | — |

⚠️ **OVO's state (Task 8.30, recorded 2026-09-17):** `platform_payment_channels.OVO` is `enabled = true,
active = true` on production (measured 2026-09-16 by the finance audit, F7) even though it was switched
OFF on 2026-08-31 after two real `rc=68 EXT TIMEOUT` attempts and Task 8.10 (the daytime re-probe)
is still open — the re-enable was never recorded against 8.10. Both remedies are **owner-gated**
(a probe creates a real bill; a disable is a production write), so neither was done by the
2026-09-17 programme: **until 8.10 records a passing daytime probe, treat OVO as an unverified
channel** — the only two real OVO payments on production are the only two `gagal` prepaid attempts.
**Resolved 2026-09-17: the owner ruled "OVO matikan aja, fokusnya VA + QRIS" — OVO is `enabled = false` on production** (audit line in `platform_activity`; Task 8.10 closed without a probe). Live prepaid channels are VA (BCA, BNI, BRI, Mandiri, Permata) and QRIS.

- **`base` is part of a fee's identity.** A pct fee without a declared base is how QRIS was 1% of
  the payable for months. Server passes BOTH candidate bases; the schedule entry decides which is
  read. The client mirror reads `data-fee-base` — neither side may hardcode a denominator.
- **VA is per-BANK via the channel code** (`platform_payment_channels.channel`), so adding a bank
  with its own price is a data edit in `CHANNEL_FEE_OVERRIDES`, not new logic.
- **COD is not in the gateway table**: it changes the ORDER total, so it lives inside
  `calculateOrderFinance` (straight 3% — the old gross-up `×0.03/0.97` is dead).
- **The COD fee has a FLOOR of Rp2.500 before VAT** (Task 8.29, 2026-09-17). KiriminAja's T&C §5
  charges US 3% + PPN 11% with a Rp2.500 minimum, so a straight 3% on a base under Rp83.333 was
  a fee we paid and did not collect (base Rp50.000: shopper 1.500 + 165, courier 2.500 + 275 →
  −Rp1.110 per parcel). `codFeeBeforeVatIdr = max(COD_FEE_MIN_IDR, round(base × COD_FEE_RATE))`;
  `checkout.astro` mirrors it by importing the SAME two constants (no literal rate in the mirror —
  `apps/storefront/src/lib/checkout-cod-floor.test.ts` fails on one). ⚠️ The rate is per COURIER
  at the vendor (J&T Express is 4%); COD is SPX-only today, so ONE rate is honest. Widening COD to
  another courier means a per-courier rate in `order-finance.ts` FIRST, not a `codAllowed` flip.
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
- ⚠️ **COD remittance gap — the platform fronts the seller's COD cash** (Task 8.29). `collectCodOnDelivery`
  credits the seller at `selesai` (the courier reported delivery), but the courier remits the cash to
  US on its own settlement cycle, days to weeks later. Between those two moments the seller can
  withdraw money the platform has not yet received. The exposure is bounded only by
  `platform_payout.release_on` (a `selesai` release makes it immediate) and the minimum payout
  (`platform_payout.min_payout_idr` — default Rp50.000, **Rp200.000 on production** since the
  operator raised it on 2026-08-24; `PRICING.md` §4 states both) —
  nothing in the schema records when the courier actually settled: **there is no `cod_settled_at`,
  no remittance fact, and no reconciliation against the courier's COD report.** Until one exists,
  treat every `available` rupiah that came from a COD sale as a platform advance, and size the
  minimum payout / release delay against the courier's real settlement lag, not against seller
  convenience.
- Payouts are settled **manually by the Super Admin** (Pencairan → Proses → Tandai lunas). The
  "Tandai lunas" dialog takes an optional **bank-transfer reference**, written in the same CAS
  statement as the status flip. `payouts.note` is keyed by terminal status: `gagal` ⇒ rejection
  reason, `selesai` ⇒ transfer reference; both render on the merchant's `/saldo` Penarikan rows
  (and the CSV export's `Keterangan` column), so both sides can reconcile against the bank statement.
- **A paid PREPAID order that is cancelled or returned owes the BUYER — and that debt has a row
  (`refunds`, migration `0112`, Task 8.31 / audit F12).** `applyOrderStatusChange` writes one
  obligation per `berhasil` non-COD payment (amount = `payments.amount_idr`, the pre-gateway-fee sum
  the buyer paid US; the gateway's admin fee is theirs) in the SAME transaction as the claw-back, so
  the seller's credit cannot be reversed with the buyer's money silently kept. COD never appears here
  (cash at the door; a refused parcel collected nothing). One OPEN row per payment is a partial unique
  index, not a check. **Nothing about a refund touches the ledger**: this money never entered the
  seller's book, so paying it back posts nothing. Settled by hand on Super Admin → Pencairan → *Refund
  ke Pembeli*: `menunggu → diproses → selesai` (transfer reference on `note`) or `→ gagal` (reason
  on `note`, required — with no ledger row to reverse, the reason is the whole record). Each step is
  one compare-and-swap in `apps/super-admin/lib/refund-transition.ts`, the payout lesson applied
  first. The dashboard float card shows *Refund ke pembeli* as its OWN tile beside *Wajib
  ditransfer* — different creditor, never summed — and the seller's order detail shows the state.

## 5. Guards

- `packages/lib/src/order-finance.test.ts` — COD 3%+VAT pin, seller-gets-PPN both modes, no
  tax-on-tax.
- `packages/lib/src/payment-fees.test.ts` — per-bank VA flats, QRIS omset base, base-field
  authority, no negative fee.
- `packages/lib/src/billing.test.ts` — `subscriptionCharge` on/off.
- `apps/admin/lib/ledger-credit.test.ts` — added-PPN credit, inclusive no-double-credit, plus the
  standing sale/claw-back suite (real Postgres).

**If this file disagrees with the code, the code wins — and this file is a bug. Fix it.**
