# Finance & pricing audit — 2026-09-16 (read-only; nothing changed yet)

> **Scope:** every rupiah path in the product — checkout pricing, payment-admin fees, COD, shipping
> reconciliation, the seller ledger and payouts, subscription billing and PPN, and every Super Admin
> control and KPI that touches money. **Method:** read the engines and their callers, run the money
> test suites, and pull **aggregated, non-personal** figures from the production database. **This
> document precedes any change** (owner instruction: "buat md doc-nya sebelum update"). The
> recommended fix order is at the end; none of it is applied. **Filed as Tasks 8.24–8.32 in
> `TASKS.md` (8.32 is the umbrella programme).**
>
> Owner of the money map: `FINANCE.md` (mechanics) · `PRICING.md` (price card). When a finding here
> disagrees with those, this file is the newer measurement and they are the ones to correct.

## 0. Verdict in one paragraph

The engines are sound and well-guarded (91 money tests green; the ledger's double-credit
impossibility, the payout compare-and-swap, the stored-PPN invoice and the COD 3 % + PPN fee all
check out against production rows). The defects are **around** the engines: the automatic renewal
invoice cannot be created as written (wrong provider channel code + the one path that makes the
merchant pay the gateway's fee), the **QRIS fee the shopper is shown is not the fee the shopper is
billed**, the Super Admin **MRR counts stores the operator comped as paying customers** (real paying
merchants today: **0**), and every platform finance KPI is dominated by seeded demo money. Below,
🔴 = wrong money or a broken path · 🟡 = misleading number or a known cost · 🔵 = hygiene.

## 1. The money map as built (one line per flow)

| flow | engine (pure) | enforced at | stored in | shown on |
|---|---|---|---|---|
| Order total | `order-finance.ts` `calculateOrderFinance` | `/api/public/order` (server re-prices everything; `checkout.astro` mirrors) | `orders.{subtotal,shipping,tax,discount,total}_idr` + `order_financials` (frozen) | checkout summary, `/checkout/sukses`, order detail |
| COD fee | same — 3 % × (omset + ongkir) + PPN 11 % on the fee, no minimum | same | `order_financials.cod_fee_*` — **inside `orders.total_idr`** | checkout "Biaya COD" + "PPN biaya COD" |
| Gateway fee (QRIS/VA/e-wallet/retail) | `payment-fees.ts` `paymentFee` (`base` is part of the fee) | **predicted** server-side (`expected_gateway_fee_idr`), **charged by the provider** (`create_payment`: buyer pays `amount + admin`) | `order_financials.expected_gateway_fee_idr` vs `payments.admin_fee` / `payments.total` — **NOT in `orders.total_idr`** | checkout "Biaya pembayaran" (predicted), sukses (actual), seller reconciliation screen |
| Goods PPN | `tax.ts` `computeTax` (store `tax_enabled`, inclusive/exclusive) | order API | `orders.tax_idr`, `order_financials.included_sales_tax_idr` | checkout, order detail |
| Shipping | `shipping-quote.ts` (one price producer) → `createShipment` re-quotes; delta reconciled | booking | `shipment_bookings.{charged,actual,seller_debit,platform_margin}` + ledger `shipping-*-debit` | order detail "Cek Ongkir" refusal, `/saldo` |
| Seller entitlement | view `order_seller_entitlements` (0102/0104) = goods + added PPN − shipping debit | — | derived | `/keuangan`, `/keuangan/penghasilan` |
| Ledger | `ledger-credit.ts` (`sale` on `payments.berhasil`; COD at `selesai`; release at `platform_payout.release_on`; `retur`/`batal` claw back the sale entry) | `applyOrderStatusChange` → `settleOrderLedger` | `ledger_entries` (balance = Σ by status; 3 partial unique indexes) | `/saldo`, Super Admin float |
| Payout | `payout.ts` (min from `platform_payout`, advisory lock, negative `payout` entry at request) → Super Admin `processPayout` → `markPayoutPaidInTxn` (CAS `diproses→selesai`) → `rejectPayout` (exact reversal) | Super Admin | `payouts`, `ledger_entries` | `/saldo`, `/pencairan` |
| Subscription | `billing.ts` (`quote`, `computeBilling`, `subscriptionCharge`) | 3 invoice creators: billing cron · merchant `/akun/langganan` · Super Admin manual | `invoices.{amount,tax}_idr`, `stores.{trial_ends_at,current_period_end,first_invoice_paid,comped}` | `/akun/langganan`, `/faktur/[number]`, Super Admin `/`, `/toko`, `/paket` |
| PPN on subscription | global toggle `platform_finance.subscription_ppn_enabled` (**OFF** on prod since 2026-08-24) | all 3 creators at creation time | stored `tax_idr` | faktur renders the stored figure only ✅ |

## 2. Production figures (2026-09-16, read-only, aggregates only)

**Policy rows.** PPN toggle **off** · payout release `selesai`, **min payout Rp200.000** (operator
change 2026-08-24) · COD on, cap Rp2.000.000, 6 provinces, `fee_pct` 0 (dead) · channels **enabled**:
OVO, QRIS, VABCA, VABNI, VABRI, VAMANDIRI, VAPERMATA (DANA/GoPay/ShopeePay/LinkAja/retail/other VAs off).

**Stores (17).** 4 VIP (`comped`) · 1 operator-suspended (`tema-platform`) · **12 "active" without a
single paid invoice** — every one of their `current_period_end` dates comes from a Super Admin
**"Gratis 1 bulan"** comp (26 such audit lines, 2026-08-06 → 2026-09-16, sometimes two per store) ·
`first_invoice_paid` is true on **one** store only (`batiknusantara`, the seeded demo, itself VIP).

**Invoices.** 5 `dibayar` = the seeded `INV-9001…9005` (Rp305.250 each, tax 0 — pre-toggle demo
rows). Real subscription invoices: **6**, all from the PPN-era (Rp55.500 / Rp305.250 incl. tax):
2 `menunggu`, 3 `gagal`, 0 paid. **Subscription revenue actually collected through the gateway: Rp0.**

**Orders (225).** **220 are seeded** (`batiknusantara`; payment methods `transfer`/`gopay` exist only
there). **5 real** orders, all `permata-store`, all with `order_financials`:

| order | channel | omset | ongkir | payable | fee predicted | fee billed by provider | outcome |
|---|---|---|---|---|---|---|---|
| `PHI-486243804HXH` | QRIS | 298.000 | 17.000 | 315.000 | 3.150 (old 1 % rule, 08-23) | **2.205 = 0,7 % × 315.000** | `menunggu` |
| `PHI-4871477672ZK` | OVO | 149.000 | 139.100 | 288.100 | 6.914 (old 2,4 %) | 0 — provider refused | `gagal`/`batal` |
| `PHI-4884586665XO` | OVO | 149.000 | 45.000 | 194.000 | 4.656 (old 2,4 %) | 0 — provider refused | `gagal`/`batal` |
| `PHI-713020233OA7` | COD | 205.000 | 8.700 | 220.816 | — | COD fee 6.411 + PPN 705 = **7.116** ✅ equals KiriminAja's own formula (3 % × 213.700, +11 %) | `selesai`, credited |
| `PHI-768771328ISC` | QRIS | 189.000 | 7.000 | 196.000 | **1.323 = 0,7 % × 189.000 (current rule)** | **1.372 = 0,7 % × 196.000** | `gagal`/`batal` |

**Ledger.** 207 entries, **all `batiknusantara`** (seed): sale pending Rp22.511.000 · sale available
Rp42.854.000 · retur −Rp588.000 · 2 payouts −Rp23.500.000 (both `selesai`). Available balance
Rp18.766.000. Every other store: Rp0. View-vs-ledger mismatches on paid orders: **2** (`PHI-4950`,
`PHI-4962` — status `selesai` yet carrying a `retur` entry; a seed inconsistency, unreachable through
the state machine). `shipment_bookings`: **0 rows** (no real booking has ever been made).

**Store settings.** Goods PPN enabled on **0** stores; COD opt-in on 1; free-shipping threshold on 1.

**Cron.** `billing` runs daily, last `{"stores":17,"statusSynced":1,"invoicesCreated":0}` — it has
never had a `past_due` store to invoice since AutoLaris was configured, so §3-F1 has never been
exercised live.

## 3. Findings

### 🔴 F1 — The automatic renewal invoice cannot be created as written

`apps/admin/app/api/cron/billing/route.ts` creates the renewal bill with:

- **`channelCode: "BCA"`** — not a provider code. The provider's channel list (`AUTOLARIS_KNOWN_CHANNELS`,
  and `platform_payment_channels` on prod) knows **`VABCA`**; the other two invoice creators send
  `VABCA`/the merchant's pick. A `create_payment` with an unknown channel returns `rc ≠ 00` → `r.ok`
  false → **no invoice row, no log line, `invoicesCreated: 0`**, and the store sits `past_due` →
  `suspended` with no bill to pay.
- **`alCreatePayment` (create_payment)** while the merchant flow and the manual invoice use
  **`alCreateOrder` (submit)**. The two differ on who pays the gateway's admin fee (`autolaris.ts`
  documents it): `create_payment` **adds** it to what the payer transfers, `submit` **nets** it against
  settlement. So the one automatic path would charge the merchant Rp275.000 **+ Rp6.500**, while the
  same merchant renewing by hand pays Rp275.000.
- **Then the callback would reject the payment.** `payCallbackAmountMatches` is an exact equality
  against `invoices.amount_idr` (Rp275.000). If the provider reports the amount it collected
  (Rp281.500), the paid callback is logged *"PAID amount does not match … ignored"* and the store never
  reactivates. (Whether the provider reports `amount` or `total` in the callback is **unverified** —
  see F9.)
- Cosmetic but real: `customerPhone: "081200000000"`, `customerEmail: "merchant@tokophi.id"` are sent
  to the provider as the payer's identity; `planKey: "bisnis"` is a legacy tier name written by all
  three creators.

**Not proven live** — no store has been `past_due` with the gateway configured. It is a code fact.
Fix: same creator function for all three paths (extract one `createSubscriptionInvoice()` that the
cron, the merchant action and the manual action call; `alCreateOrder`, real channel code, owner's
email), plus one test that drives the cron against a `past_due` store with a stubbed provider.

### 🔴 F2 — The QRIS fee the shopper sees is not the fee the shopper pays

Owner ruling (2026-08-24): QRIS = 0,7 % **of omset**. The provider bills 0,7 % **of the amount we
submit** (`amount` = `orders.total_idr` = goods + PPN + ongkir + COD fee). Measured on production:
`PHI-768771328ISC` predicted **Rp1.323** (0,7 % × 189.000), billed **Rp1.372** (0,7 % × 196.000);
`PHI-486243804HXH` billed 2.205 = 0,7 % × 315.000. The difference is 0,7 % × (ongkir + goods PPN) on
every QRIS order — Rp49 and Rp119 here, but it is the **shopper** who pays it: the checkout summary
shows the lower number, the VA/QR bill carries the higher one, and `checkout/sukses.astro` already
carries a warning block about exactly this ("the gateway's admin fee is added after the shopper
agreed to the total… a shopper who transfers the number they remember underpays"). `feeMismatch` is
returned to the browser and the seller's reconciliation screen flags every such order, permanently.

Two honest resolutions, the owner's call: (a) keep the ruling and **collect the fee ourselves** —
include `gatewayFeeIdr` in what we submit and use the `submit` endpoint (fee netted, shopper pays
exactly the number shown) — or (b) change the ruling's base for QRIS to the payable, matching the
provider. (a) keeps "0,7 % dari omset" true for the shopper and moves the 0,7 % × (ongkir+PPN) to the
platform, which is the ruling's own intent ("biaya admin masuk di kita" applies to the *seller*, not
the shopper). Either way `FINANCE.md` §3's "ENFORCED in checkout pricing" is only half true today:
the gateway fee is *predicted* by us and *charged* by the provider.

### 🔴 F3 — MRR / ARR / "Pelanggan berbayar" count comped stores as paying

`getSubscriptionStats` adds Rp50.000 or Rp275.000 for every store whose `computeBilling().status`
is `active` and that is not `comped`. On production that is the **12 stores whose only "paid" period
is a Super Admin "Gratis 1 bulan"** → the dashboard reads **MRR ≈ Rp600.000, ARR ≈ Rp7,2 jt, 12
pelanggan berbayar, ARPU Rp50.000**, while **zero merchants have ever paid**. `Diterima (total)
Rp1.526.250` = the five seeded `INV-900x` rows. A comp is entitlement without revenue; the KPI cannot
tell them apart because `compStore` only moves `current_period_end`.

Fix: make a comp a **fact**, not a silent period move — e.g. `invoices` row `kind = 'comp'`
(amount 0, `period_months`) written by `compStore`, or `stores.comped_until` — and define MRR as
"stores whose current period is backed by a **paid** invoice". `ARPU` and "Pelanggan berbayar"
follow. `revenuePaid` should exclude the demo store (F8).

### 🟡 F4 — COD: the platform fronts the seller's cash, and KiriminAja's minimum fee is not modelled

- `collectCodOnDelivery` marks the COD payment `berhasil` and credits the seller **when the seller
  presses `selesai`**, i.e. when the courier says delivered — but KiriminAja **remits COD to the
  platform later** (its own settlement cycle). Between those two moments the seller can withdraw money
  the platform has not received. With `release_on = selesai` and min payout Rp200.000 the exposure is
  bounded but real, and grows with COD volume. There is no `cod_settled_at` / remittance fact anywhere.
- KiriminAja's COD fee is 3 % + PPN 11 % **with a Rp2.500 minimum** (4 % for J&T Express — T&C §5).
  Ours is a straight 3 %. Below a base of Rp83.333 the platform pays more to the courier than it
  charged the shopper (base Rp50.000: shopper pays 1.500 + 165, courier keeps 2.500 + 275 → −Rp1.110
  per parcel). No such order exists yet; the rule should exist before one does (`Math.max(2_500, …)`
  in `calculateOrderFinance`, and the checkout mirror).
- ADR 0014 says the platform absorbs the courier's shipping cost on COD; `getCourierCostAbsorbed`
  reports it, but with **0 real bookings** the figure is empty today.

### 🟡 F5 — Two "revenue" numbers for one seller, and both include unpaid orders

- Dashboard "Penjualan hari ini" = `total_idr − tax_idr` (goods + **ongkir + COD fee**, minus goods
  PPN). Keuangan "Omzet" = `seller_entitlement_idr` (goods only). Same store, same day, two figures.
- Both count orders whose money was **never collected**: the filter is `status ∉ (batal, retur)`,
  so a prepaid order sitting `baru`/`pending` (VA never paid) is revenue until it expires. On prod
  today: 4 of `permata-store`'s 5 real orders are `pending` and would appear in "Omzet 30 hari" as
  Rp873.100 of which Rp0 was received.

Fix: Keuangan should key on `financial_status = 'dibayar'` (or COD at `selesai`), and the dashboard
tile should say what it sums ("termasuk ongkir") or use the same base.

### 🟡 F6 — Price card says one thing, the setting says another

`PRICING.md` §4: minimum payout **Rp50.000**. Production `platform_payout.min_payout_idr` =
**Rp200.000** (operator change 2026-08-24, audited). `requestPayoutInTenant` falls back to 50.000
only when the row is missing. The card is a promise to merchants; either the number or the sentence
("default Rp50.000; the platform may raise it — currently Rp200.000") must change.

### 🟡 F7 — OVO is live at checkout while its re-probe task is open

`platform_payment_channels.OVO` is `enabled = true, active = true`. `TASKS.md` 8.10 ("Re-probe OVO in
the daytime window before re-enabling") is `[ ]`; the two real OVO payments on production are the
only two `gagal` prepaid attempts (`rc=68` class). Either the probe is run and recorded, or OVO is
disabled until it is.

### 🟡 F8 — Seeded demo money is presented as platform money

`batiknusantara` (VIP) owns 220 of 225 orders, all 207 ledger entries (available Rp18,8 jt, pending
Rp22,5 jt), both payouts (Rp23,5 jt), the 5 paid invoices and 2 of the view-vs-ledger mismatches.
The Super Admin dashboard shows "Saldo merchant Rp41,3 jt", "Diterima Rp1,5 jt", GMV — all demo. An
operator reading the control plane cannot see that the platform has collected Rp0. Options: purge the
seed from production (the deploy re-seeds only what is missing — check `seed-guard`), or flag the
demo store and exclude it from every platform KPI (`stores.is_demo`).

### 🔴 F9 — The paid-callback amount gate has never met a real callback, and the vendor's payload is unpublished

`pay/callback` accepts a PAID event only when `payCallbackAmountMatches(body.amount,
payments.amount_idr)` — an **exact** integer equality against the pre-fee amount, added in a
security pass ("exact payment amount gating", BUILD-LOG) and pinned by tests that construct the body
themselves. Re-validated 2026-09-16:

- The vendor reference in the repo's own AutoLaris skill says, verbatim, *"Payload callback belum
  dipublikasikan."* Nothing documents whether the callback carries `amount` at all, or whether it is
  the base amount or the collected total (`amount + admin`).
- If `amount` is **absent**, `payCallbackAmountMatches(undefined, …)` is `false` ⇒ `matched = []` ⇒
  the PAID callback is logged *"ignored"* and **nothing is written**. If it is the collected total,
  the same. Only the exact base amount passes.
- **Production has never completed a gateway payment**: every AutoLaris row is `menunggu` or `gagal`
  (QRIS 4 + 4, VA 2); the 2026-08-26 "real payment" evidence was a live `create_payment` (bill
  created), not a settlement. The container's log covers only today's deploy, so "no callback line"
  proves nothing either way.

So the prepaid path's last step — money in, order `dibayar`, seller credited — has **never been
observed end to end**, and the gate in front of it is strict on a contract nobody has read. Failure
mode if wrong: the shopper pays, the order stays unpaid, the seller is never credited, the money sits
with the provider/platform. One real paid callback (shape and amounts, captured off the wire) is the
cheapest, most valuable measurement left in this product. Until it exists, the gate should log the
FULL shape of a rejected PAID body (field names, types, lengths — never values) so the first real
rejection explains itself, the way the KiriminAja webhook already does.

### 🔴 F12 — A paid prepaid order that is cancelled has no refund path, and the buyer's money is invisible

`applyOrderStatusChange` on `batal`/`retur` restores stock, fails only **`menunggu`** payments, and
`settleOrderLedger` claws back the seller's sale. A payment already `berhasil` stays `berhasil`: the
buyer's money is held by the platform, no row records that it is owed back, no screen shows it, and
no action returns it (there is no refund flow anywhere in `apps/admin/lib`). Production exposure
today: **0 orders / Rp0** (measured), because no gateway payment has ever completed — which is
exactly why it has not hurt yet. The moment F9 is fixed, this becomes live money owed to shoppers.
Needs: a `refunds` fact (or ledger kind) written at cancellation of a paid order, a Super Admin
queue to settle it (manual transfer, like payouts), and the buyer-facing status.

### 🔵 F13 — The traceability guard crashed instead of reporting (fixed in this pass)

`scripts/verify-traceability.mjs` used `docs.map(basename)`; `Array.map` passes the index as
`basename`'s second argument, so the first time the guard had a problem to REPORT it threw
`TypeError` instead. Found because the new tasks tripped it. Fixed to `map((d) => basename(d))`.

### 🔵 F10 — Documentation drift found on the way

- `STATUS.md` §1: *"`payment-fees.ts` has ZERO importers … fee-bearer feature does not exist"* — the
  schedule has been enforced (predicted) at checkout since 2026-08-24; *"credits `amount_idr` — never
  `total`"* — the credit is `goods_proceeds_idr + added PPN` since 0102.
- `FINANCE.md` §3 "ENFORCED" — see F2 for the exact half-truth; §4 payout rules do not mention the
  Rp200.000 setting.
- `AGENTS.md`/docs: OVO "switched OFF 2026-08-31" — it is on (F7).
- `platform_cod.fee_pct`, `store_settings.payment_fee_bearer`, `payments.method` values
  `transfer`/`gopay` — dead or seed-only, already known; listed so nobody reads them as live.

### 🔵 F11 — Small things that are right and worth keeping that way

- Subscription PPN toggle: all three creators read it at creation and store `tax_idr`; the faktur
  renders the stored figure and hides the line when 0 ✅.
- `setInvoiceStatus` is bookkeeping only (ruling 2026-08-20) — verified in code and pinned ✅.
- Payout: request debits immediately under an advisory lock; `markPayoutPaidInTxn` is a CAS; rejection
  reverses exactly Σ ledger for that payout ✅.
- Claw-back reverses the sale entry's own amount; `retur` and `batal` both excluded from crediting ✅.
- COD fee for SPX equals KiriminAja's formula to the rupiah on the one real COD order ✅.
- `orders.total_idr = order_financials.order_payable_idr` on all 5 real orders ✅.
- Money suites: `order-finance`, `payment-fees`, `billing`, `tax`, `ledger-credit`, `payout-transition`,
  `invoice-flip-is-bookkeeping`, `commerce-lifecycle` — **91/91 green** on this audit's run.

## 3b. Re-validation pass (same day, before the tasks were filed)

| claim | re-checked how | result |
|---|---|---|
| F1 `"BCA"` is not a provider code | `alCreatePayment` passes `channel_code` verbatim (no normalisation); provider list + prod `platform_payment_channels` know `VABCA` only | **confirmed** |
| F2 QRIS billed on the payable | two production orders: 2.205 = 0,7 % × 315.000; 1.372 = 0,7 % × 196.000 | **confirmed** |
| F3 comps counted as MRR | 26 "Gratis 1 bulan" audit rows; `getSubscriptionStats` reads `computeBilling().status` only | **confirmed** |
| F5 unpaid orders in Omzet | `SALES` filter excludes only `batal`/`retur`; 4 pending real orders | **confirmed** |
| F9 callback amount | vendor: payload unpublished; gate exact; prod: 0 completed gateway payments ever | **upgraded to 🔴** |
| batiknusantara orders are seed | payment methods `transfer`/`gopay` exist only there; `INV-900x` seeded | **confirmed (owner asked)** |
| refund of paid-then-cancelled | state machine fails `menunggu` only; no refund code | **new 🔴 F12**, exposure Rp0 today |
| money suites | 8 suites, 91 tests | green |

## 4. Recommended order of work (not started — needs the owner's go)

| # | fix | size | touches |
|---|---|---|---|
| 1 | **F1** one `createSubscriptionInvoice()` used by cron, merchant and manual paths (`alCreateOrder`, real channel code, owner email, no `planKey`), + a cron test with a `past_due` fixture | M | `cron/billing`, `actions/billing.ts`, `super-admin/actions.ts`, new lib + test |
| 2 | **F2** owner decides (a) collect the gateway fee ourselves via `submit` with `total = buyerPayable`, or (b) QRIS base = payable; then `FINANCE.md`/`PRICING.md` follow | S–M | `order/route.ts`, `payment-fees.ts`, checkout mirror, docs |
| 3 | **F9** log the SHAPE of a rejected PAID body now; capture one real callback; then decide the gate (exact / tolerant / Advice-confirmed) | S | `pay/callback`, evidence |
| 3b | **F12** refund fact + Super Admin refund queue for paid-then-cancelled prepaid orders | M | `order-status.ts`, migration, `/pencairan`-like screen |
| 4 | **F3** comps become invoices of kind `comp`; MRR/ARPU/"berbayar" = paid-invoice-backed periods | M | `compStore`, `getSubscriptionStats`, dashboard, `0111` |
| 5 | **F8** flag/purge demo money in platform KPIs | S–M | data.ts or ops SQL |
| 6 | **F5** Keuangan on collected money; dashboard tile labelled | S | `data/finance.ts`, dashboard |
| 7 | **F4** COD fee floor Rp2.500 (+ mirror + test); record the remittance gap as a known exposure in `FINANCE.md` | S | `order-finance.ts`, checkout, docs |
| 8 | **F6/F7/F10** docs and the OVO decision | S | `PRICING.md`, `STATUS.md`, `FINANCE.md`, `AGENTS.md`, Task 8.10 |

## 5. How this was measured

- Code read in full: `packages/lib/src/{billing,payment-fees,order-finance,tax}.ts`,
  `apps/admin/lib/{ledger-credit,payout,cod,shipment-payment}.ts`, `apps/admin/lib/actions/{ledger,billing}.ts`,
  `apps/admin/lib/data/{billing,finance,ledger,platform-finance,reconciliation}.ts`,
  `apps/admin/app/api/public/order/route.ts` (money sections), `apps/admin/app/api/public/pay/callback/route.ts`,
  `apps/admin/app/api/cron/billing/route.ts`, `apps/super-admin/lib/{actions,data}.ts` (money
  functions), `apps/super-admin/app/(platform)/page.tsx` tiles, `checkout.astro` fee mirror,
  `checkout/sukses.astro`, `faktur/[number]`, `/akun/langganan`, `FINANCE.md`, `PRICING.md`, `STATUS.md`.
- Tests run: the eight money suites above (91/91).
- Production: read-only `psql` from the box, aggregates and order numbers only — no names, phones,
  addresses or bank details were selected.
