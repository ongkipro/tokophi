# Finance overhaul — subscription PPN toggle + order fee schedule (owner rulings 2026-08-24)

**Status:** done (verification recorded in BUILD-LOG FIN-01) · branch `feat/finance-overhaul` · summary doc: **`specs/docs/FINANCE.md`**

## The rulings (verbatim intent)

1. **Subscription PPN is a GLOBAL toggle, DEFAULT OFF at launch** — Super Admin → Pengaturan →
   Keuangan, never per-tenant. Off = sellers pay flat Rp275rb (DPP). Applies to the **next**
   invoice of new AND running stores; issued invoices are never rewritten.
2. **COD fee = 3% of (goods omset + shipping charged), then PPN 11% on that fee.** Straight
   percentage — the old gross-up `×0.03/0.97` is dead.
3. **QRIS admin = 0,7% of the goods omset** (never the payable).
4. **VA BCA Rp6.500 flat; every other bank Rp3.500 flat** (per channel code, data-driven override).
5. **Fees are shown at public /checkout** per selected method.
6. **Seller receives goods omset + goods PPN only** (they remit the tax); shipping money and every
   payment-admin fee are platform revenue. **No tax-on-tax**: the goods PPN line is outside every
   fee base.

## What changed (all in this branch)

| Area | Files |
|---|---|
| Toggle storage | `packages/db/drizzle/0101_platform_finance.sql` (platform_finance id=1 CHECK, default FALSE; `invoices.tax_idr` + backfill), `schema.ts` |
| Charge fn | `packages/lib/src/billing.ts` → `subscriptionCharge(base, ppnEnabled)` |
| 3 invoice creators | `api/cron/billing/route.ts` · `lib/actions/billing.ts` · super-admin `createManualInvoice` — all read the toggle, all store `tax_idr` |
| Faktur honesty | `lib/data/billing.ts` (`taxIdr` in getFaktur + getMyInvoices), `app/faktur/[number]/page.tsx` renders STORED tax |
| Display parity | `akun/langganan/page.tsx` + `pay-subscription.tsx` (ppnEnabled prop; flat copy when off) |
| Toggle UI | super-admin `pengaturan-client.tsx` "Keuangan" card + `setSubscriptionPpn` action (platformGate, audit-logged) + `getPlatformFinance` |
| Fee schedule | `packages/lib/src/payment-fees.ts` — `base` field, `CHANNEL_FEE_OVERRIDES.VABCA`, `channelFeeValue`, `paymentFee(kind, {omsetIdr,payableIdr}, code)` |
| Order engine | `packages/lib/src/order-finance.ts` — COD 3% base, seller entitlement carries goods PPN |
| Boundary | `api/public/order/route.ts` passes both bases + channel code |
| Checkout mirror | `checkout.astro` — per-bank `data-fee-value`, `data-fee-base`, codCharges 3%+VAT |
| Ledger | `lib/ledger-credit.ts` — sale credit = `goods_proceeds + (orders.tax_idr − included_sales_tax_idr)` |
| Docs | `FINANCE.md` (new), AGENTS.md (billing bullet, fee note, docs table), SCHEMA/CODE_MAP/STATUS counts → 102/`0101`/82 |

## Guards (all proved green; see BUILD-LOG for the run)

`order-finance.test.ts` (COD pin, both tax modes, no tax-on-tax) · `payment-fees.test.ts` (new) ·
`billing.test.ts` (`subscriptionCharge`) · `ledger-credit.test.ts` (+2: added-PPN credit,
inclusive no-double-credit) · `doc-counts.test.ts` (counts moved with 0101).

## Traps for the next agent

- **The toggle is read at INVOICE CREATION and stored.** Never derive faktur PPN from
  `baseFromTotal` again — a toggle-off invoice would show invented tax.
- **`base` on a fee is part of its identity.** Both server and the checkout client read it; do not
  hardcode a denominator anywhere.
- **Migration 0101 was applied to the shared dev DB manually (SQL, idempotent), journal stamp NOT
  recorded** — drizzle will re-run it harmlessly on merge. Stamp `when=1787388586123` exceeds the
  dev DB's newest.
- Default state is **OFF** — after any verification that flips it ON, flip it back.
