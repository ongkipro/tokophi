# ADR 0020 — Subscription pricing 2026-11: Rp178.500, annual −20%, no first-month promo, a first-invoice code discount

**Status:** accepted (owner, 2026-11-13; defaults in §6 owner-confirmable) · **Date:** 2026-11-13 · **Task:** `BILL-PRICE-2026-11`
**Supersedes:** the pricing lines recorded in `AGENTS.md` "Billing & super-admin control", `specs/docs/FINANCE.md` §1,
`specs/PRD.md` §6 and `specs/docs/PRICING.md` §1 (3-day trial → Rp50rb first month → Rp275rb/mo, annual Rp2,7jt).
**Extends:** ADR 0019 (signup codes) — a code may now carry a discount as well as a shipping provider.
**Number is provisional until merge** — re-scan `specs/decisions/` on `main` before merging and renumber if taken.

## 1. Context

The owner ruled on 2026-11-13 (final):

1. Monthly price **Rp178.500** (DPP, ex-tax; the global PPN toggle still applies on top, unchanged).
2. Annual = monthly × 12 with a **20% discount** = **Rp1.713.600** (Rp142.800/month effective).
3. Trial stays **3 days**.
4. The **Rp50.000 first-month promo is removed** — without a code the first invoice is the normal price.
5. A store that signed up WITH a code that carries a discount gets **Rp100.000 off its FIRST subscription invoice
   only**, once per store: first monthly Rp78.500, first annual Rp1.613.600. Every later invoice is normal.
6. **One field "Kode"** on `/daftar`: ADR 0019's signup codes are extended — a code can set the shipping provider
   AND/OR carry the first-invoice discount. The `?kode=` link is the referral link.
7. **Existing stores move to the new price from their NEXT invoice**; invoices already issued keep their amounts.

## 2. Considered options

For the discount's home:
- **A — A separate "referral code" table and a second field on `/daftar`.** Refused: decision 6 says one field.
- **B — A global discount amount in `BILLING`, granted to any code.** Refused: a provider-only code (all codes
  existing today) would silently start granting money nobody decided to grant.
- **C — A per-code amount on `signup_codes` (chosen).** `discount_first_invoice_idr`, 0 = provider-only.

For "first invoice" (the never-twice rule):
- **(i) Consumed at ISSUANCE** — the first invoice ever issued carries it; a re-issue never does. Refused: the
  Seller's own "Batalkan tagihan" (switch monthly → annual) and every expired VA would forfeit a discount the
  merchant never received — and the owner's annual example (Rp1.613.600) is typically reached exactly that way.
- **(ii) Consumed at PAYMENT (chosen)** — the discount belongs to the store's first PAID subscription invoice.

## 3. Decision

**Prices are code, not data.** `BILLING` (`packages/lib/src/billing.ts`): `MONTHLY_IDR 178_500`,
`ANNUAL_DISCOUNT_PCT 20`, `ANNUAL_IDR 1_713_600`, `ANNUAL_MONTHLY_IDR 142_800`, `TRIAL_DAYS 3`;
`FIRST_MONTH_IDR` is **deleted** (so `tsc` finds every reader). `billing.test.ts` pins annual to the formula.
`quote(cycle, firstInvoicePaid, owedDiscount)` returns `listAmount`, `codeDiscountIdr`, `amount`.

**Data (migration 0119, hand-written, idempotent).**
`signup_codes.discount_first_invoice_idr bigint not null default 0` (existing codes → 0).
`invoices.code_discount_idr bigint not null default 0` + `invoices.discount_code text` (CHECK: a discount names
its code) — stored at creation like `tax_idr`, so the faktur prints the row, never today's code or price.
List price of any invoice = `amount_idr − tax_idr + code_discount_idr`.
Partial UNIQUE `invoices_one_live_code_discount (store_id) where code_discount_idr > 0 and status = 'menunggu'`.

**The ONE rule — `codeDiscountFor()`** (pure, `@tokophi/lib/billing`): owed = the code's amount unless the store
is comped, `first_invoice_paid`, or has ANY `dibayar` non-comp invoice (an operator's manual "Lunas" flip does not
set the flag — ruling 2026-08-20 — and must still consume it). The code's `active` flag is NOT read.
**`owedCodeDiscount(storeId)`** (`@tokophi/db/subscription-invoice`, owner pool — `signup_codes` is RLS-no-policy)
resolves it from the store's own facts. **`createSubscriptionInvoice` is the only place a discount is applied**:
`quote(cycle, firstInvoicePaid, owed)` → `subscriptionCharge(amount, ppn)` — **PPN on the discounted DPP** — and
`amount_idr`, `tax_idr`, `code_discount_idr`, `discount_code` all stored. The Seller's Langganan / Keuangan / banner
and the Super Admin store card preview the next amount through the SAME resolver, so preview = bill.

**Never twice.** (a) The creator reuses a live invoice (existing rule). (b) Two racing creators: the unique index
lets one insert win; the loser answers with the winner's invoice. (c) The index is on `menunggu` ONLY — not
`dibayar` — because `pay/callback` may legally move `gagal → dibayar` (a PAID that arrives after its EXPIRED); an
index that failed that UPDATE would turn received money into a 500. (d) Once anything is paid, `codeDiscountFor`
answers 0 forever. **Residual, accepted, bounded by one discount amount:** a merchant who pays a CANCELLED
discounted VA (cancellation is ours only — the VA stays live at the provider) AND its discounted re-issue pays two
discounted invoices; both buy their own period.

**Existing stores (decision 7).** Nothing re-prices a stored invoice. A pending invoice issued before the deploy —
including a pending Rp50.000 promo invoice — is reused as issued and payable at its amount. A store that has not
been invoiced yet gets the new price; with no code (every existing store: codes before 0119 carry 0) that is the
normal Rp178.500 — consistent with 4/5. A store that already paid gets Rp178.500 from its next invoice.

**Segment.** `first_month` → **`first_invoice`** ("Tagihan 1"): same predicate (trial over, `first_invoice_paid`
false), so Super Admin segment counts do not move; only the name and the price stopped claiming a promo. MRR
(`subscription-kpi.ts`) is the list price — the code discount is one-off, not recurring.

**Super Admin.** Kode Daftar form gains "Potongan tagihan pertama (Rp)", pre-filled `BILLING.SIGNUP_CODE_DISCOUNT_DEFAULT_IDR`
(100.000); bounds 0 ≤ d < monthly price (a code never mints a Rp0 bill); set at creation only (no edit path — the amount
a store signed up under cannot change); the audit line reports the stored amount (`.returning()`); rank unchanged
(`SHIPPING_PROVIDER_MIN_RANK`, owner). The list shows each code's discount.

**Seller / public.** `/daftar` field label **"Kode"**; a valid discount code answers "Kode diterima — potongan
Rp100.000 untuk tagihan langganan pertama." Langganan shows the discounted next amount and the code; the faktur
prints "Paket TokoΦ Rp178.500 · Potongan kode XXX −Rp100.000 · Subtotal (DPP) Rp78.500 · [PPN] · Total". The faktur
and the payment history read the invoice's stored **cycle** (they guessed it from the amount: "≥ Rp2jt = annual",
which the new annual price fails). Landing (`apps/landing`) reads every number from `BILLING`; the hand-typed
`/harga/` title/description and the OG image source were the only literal prices and are fixed.

## 4. Consequences

- **Positive:** one price list in one module; the discount is a stored, printed fact of the invoice; the preview
  and the bill come from one resolver; double discounts are a DB impossibility for live invoices.
- **Negative:** a code is now worth money — a leaked discount code grants up to its amount on a still-unapproved
  store (SECURITY.md). Production `public/og.png` must be re-rendered from `design/og.html` (done in this PR).
- **Neutral:** PPN toggle, billing lifecycle, suspension, comp and the 13-month bonus are unchanged.

## 5. Confirmation

`packages/lib/src/billing.test.ts` (prices, formula, quote, `codeDiscountFor`, PPN truth table),
`packages/db/src/subscription-invoice-pricing.test.ts` (real Postgres, 15 cases: no code / code monthly + annual /
second invoice / reuse / manual Lunas / cancel → re-issue / DB impossibility / race / existing store / provider-only /
deactivated code / VIP / PPN on), `apps/admin/app/api/cron/billing/route.test.ts` (renewal at 178.500, no promo),
`apps/super-admin/lib/store-shipping-provider.test.ts` (discount bounds, audit from the stored row),
`apps/super-admin/lib/subscription-kpi.test.ts` (MRR = list price). Mutation proofs: BUILD-LOG `BILL-PRICE-2026-11`.

## 6. More information — owner-confirmable defaults

1. The "annual straight after trial = 13 months" bonus is **kept** and combines with the code discount
   (first annual with code = Rp1.613.600 for 13 months).
2. Discount stored per code, form default Rp100.000, 0 = none; set at creation only; owner rank.
3. A code deactivated after signup is **honoured** (granted at signup).
4. "First invoice" = first **paid** invoice (§2); a cancelled/expired unpaid one gives the discount back.
5. Existing codes get discount 0 (they were handed out as provider codes).
6. A pending Rp50.000 promo invoice issued before the deploy stays payable at Rp50.000.
