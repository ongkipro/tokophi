# AUDIT — Batch 2: Payment & Checkout

> **Scope:** TokoΦ checkout funnel, payment gateway integration (AutoLaris), COD policy, price/tax/voucher computation, callback verification, idempotency and transaction rollback protection.
> **Method:** static, evidence-based review of repository source, schema, migrations and test suites. **No application code was modified.**
> **Repository root:** `/home/ongki/Projects/tokophi`
> **Audit date:** 2026-08-15
> **Classification:** Internal engineering — contains exploitable detail. Do not distribute outside the platform team.

---

## Table of Contents

1. [Executive Summary & Domain Scope](#1-executive-summary--domain-scope)
2. [Current Implementation Analysis & Code Evidence](#2-current-implementation-analysis--code-evidence)
3. [Edge Case, Regression & Vulnerability Assessment](#3-edge-case-regression--vulnerability-assessment)
4. [Test Suite Coverage & Regression Matrix](#4-test-suite-coverage--regression-matrix)
5. [Actionable Engineering Perfection Directives](#5-actionable-engineering-perfection-directives)

---

## 1. Executive Summary & Domain Scope

### 1.1 Verdict

The TokoΦ payment domain is **materially stronger than a typical Indonesian commerce SaaS at this stage**. The money path has real, DB-enforced guarantees that most implementations only claim: order creation, stock decrement, voucher redemption and the payment shell are written in **one Postgres transaction**; voucher quota is enforced in the `UPDATE ... WHERE` predicate rather than by a pre-check; the ledger has **partial unique indexes** that make double-crediting physically impossible; and the callback state machine is **forward-only out of `berhasil`**, so a replayed `EXPIRED` cannot un-collect money.

The residual risk is concentrated in four places, all of which sit **outside** the transaction boundary that was so carefully built:

| # | Concentration of risk | Severity |
|---|---|---|
| A | **Callback authorization is a single static secret carried in the URL query string**, shared by every store and every order, disclosed to a third party by construction, with no HMAC, no nonce and no rotation. | **P0** |
| B | **The callback trusts the caller's `status` field absolutely** — no amount check, no currency check, no server-to-server inquiry against the gateway. Payment authorization is single-factor. | **P0** |
| C | **`payments.reff_id` / `trx_id` are indexed but not unique**, while the callback's `UPDATE` matches on `or(trx_id, reff_id)` with no row limit. Duplicate live bills are prevented only by a check-then-act guard in application code. | **P0** |
| D | **Nothing reclaims an abandoned prepaid order.** Stock is committed at order creation; an `EXPIRED` callback writes only the payment row. No sweep, no cron, no TTL. | **P0** |

None of the four is a coding mistake in the sense of a wrong line. Each is a **missing boundary**: the transaction protects what happens *inside* checkout, and the gaps are all in what happens *after* the response is sent.

### 1.2 What was audited

**Storefront (buyer-facing)**

- `apps/storefront/src/pages/checkout.astro` — the cart checkout (2,759 lines: SSR frontmatter + inline client money engine)
- `apps/storefront/src/components/OrderFunnel.astro` — the single-product COD funnel used by `/promo/<handle>` and `/lp/<slug>`
- `apps/storefront/src/pages/checkout/sukses.astro` — the invoice / payment-instruction screen
- `apps/storefront/src/layouts/CheckoutLayout.astro`, `src/data/catalog.ts` (channel/tax/COD/free-ship loaders)

**API boundary (admin app, public routes)**

- `apps/admin/app/api/public/order/route.ts` — the only order-creating endpoint (1,342 lines)
- `apps/admin/app/api/public/pay/callback/route.ts` — the AutoLaris webhook (177 lines)
- `apps/admin/app/api/public/promo/route.ts` — the cross-origin voucher oracle
- `apps/admin/lib/public-guard.ts` — IP extraction, fixed-window rate limiting, capped body read

**Domain libraries**

- `packages/lib/src/autolaris.ts` — PSP client (create payment, probe, connectivity test)
- `packages/lib/src/pay-callback.ts` — callback URL builder
- `packages/lib/src/order-finance.ts` — canonical immutable order-money calculation
- `packages/lib/src/payment-fees.ts` — platform gateway fee table
- `packages/lib/src/tax.ts` — merchant PPN computation
- `apps/admin/lib/promo.ts` — `applyDiscount`, the single voucher validator/pricer
- `apps/admin/lib/cod.ts` + `cod-policy.ts` — the five-switch COD gate
- `apps/admin/lib/ledger-credit.ts` — money-in-hand → merchant ledger
- `apps/admin/lib/actions/payments.ts` — merchant-initiated manual bill
- `apps/admin/lib/actions/billing.ts`, `apps/super-admin/lib/actions.ts`, `apps/admin/app/api/cron/billing/route.ts` — subscription billing (shares the same PSP + callback)

**Data layer**

- `packages/db/src/schema.ts` — `orders`, `order_financials`, `payments`, `discounts`, `discount_usages`, `ledger_entries`, `checkout_sessions`
- `packages/db/drizzle/0040_ledger_payouts.sql`, `0041_ledger_credit_sale.sql`, `0085_payment_lookup_indexes.sql`

### 1.3 Findings by severity

| ID | Finding | Severity | Confidence |
|---|---|---|---|
| **PAY-01** | Callback secret is a bearer token in a URL query string, platform-wide, non-rotating, disclosed to the PSP | P0 | Confirmed |
| **PAY-02** | Callback performs no amount / currency / inquiry verification | P0 | Confirmed |
| **PAY-03** | No unique constraint on `payments.reff_id`; duplicate-bill guard is check-then-act | P0 | Confirmed |
| **PAY-04** | No expiry sweep: abandoned prepaid orders hold stock indefinitely | P0 | Confirmed |
| **PAY-05** | `alCreatePayment` has no request timeout, and runs *after* the order commit | P1 | Confirmed |
| **PAY-06** | `expiryStamp()` emits local-time `YYYYMMDDHHMMSS` with no offset; no `TZ` pinned in deploy config | P1 | Confirmed (impact unverified against vendor spec) |
| **PAY-07** | Six channels are persisted as `method = 'va'`, discarding the real instrument | P1 | Confirmed |
| **PAY-08** | Rate limiting is per-process in-memory; multiplies with replicas, resets on deploy | P1 | Confirmed |
| **PAY-09** | No per-customer voucher redemption limit exists in the schema | P1 | Confirmed |
| **PAY-10** | Public promo oracle discloses exact minimum-purchase thresholds cross-origin | P1 | Confirmed |
| **PAY-11** | `Access-Control-Allow-Origin: *` on the order-creating endpoint, no Origin allow-list | P1 | Confirmed |
| **PAY-12** | `feeMismatch` is computed and displayed but never persisted or alerted | P2 | Confirmed |
| **PAY-13** | Gateway enrichment `UPDATE` is outside the transaction; a failure loses `trx_id` | P2 | Confirmed |
| **PAY-14** | COD fee (3%/0.97 + 11% VAT) and PSP fees are hard-coded constants, not configuration | P2 | Confirmed |
| **PAY-15** | The checkout money engine is duplicated in browser JavaScript in two components | P2 | Confirmed |
| **PAY-16** | `alProbeChannels` issues 17 sequential real `create_payment` calls with no timeout | P2 | Confirmed |
| **PAY-17** | Replay idempotency is keyed on a client-generated `sessionId` | P2 | Confirmed |

---

## 2. Current Implementation Analysis & Code Evidence

### 2.1 Architecture of a TokoΦ order

```
Browser (checkout.astro | OrderFunnel.astro)
  │  client-side estimate only — never authoritative
  ├─► POST /api/public/ongkir      (shipping quote)
  ├─► POST /api/public/promo       (voucher preview, side-effect free)
  └─► POST /api/public/order  ──────────────────────────────────────────┐
                                                                        │
  apps/admin/app/api/public/order/route.ts                              │
   1. rateLimited(req,"order",10,60_000)      in-process fixed window    │
   2. readPublicBody(req, CORS)               hard byte ceiling          │
   3. store resolve + field validation        normalizePhone/Name/…      │
   4. sessionId replay guard                  checkout_sessions→orders   │
   5. per-item product/variant resolve        SERVER price, exact-title  │
   6. quoteShipping(...)                      fresh server quote         │
   7. applyDiscount(...)                      advisory read              │
   8. computeTax(...) + calculateOrderFinance(...)                       │
   9. COD gate (five switches must agree)                                │
  ┌── 10. db.transaction ────────────────────────────────────────────┐  │
  │      customer upsert → order → order_financials → order_items    │  │
  │      → inventory decrement (guarded) → payment shell (pending)   │  │
  │      → discount_usages insert → discounts.used_count conditional │  │
  └──────────────────────────────────────────────────────────────────┘  │
  11. alCreatePayment(...)   ⚠ network call AFTER commit, no timeout     │
  12. UPDATE payments SET trx_id, VA, fees   ⚠ outside the transaction   │
  13. JSON response (CORS *)  ───────────────────────────────────────────┘

AutoLaris ──► POST /api/public/pay/callback?token=<static secret>
   forward-only payment transition → orders.financial_status
   → releasePurchase() (tracking) → creditSaleForPayment() (ledger)
```

### 2.2 The transaction boundary — what is genuinely correct

The single most important property of this codebase is that **the money-critical writes are one transaction**. `apps/admin/app/api/public/order/route.ts:785` opens `db.transaction(async (tx) => …)` and the customer upsert, the order row, `order_financials`, the line items, the inventory decrement, the payment shell, the `discount_usages` row and the `discounts.used_count` bump all execute inside it. The route's own commentary states the failure it was written against:

> `// customer × order × line items × stock were four unguarded statements. A throw between any two`
> `// left an order with partial line items and partially decremented stock — a half-order nobody can`
> `// reconcile, because nothing records that it is half.`

Two domain errors escape that transaction as typed exceptions and are translated into actionable HTTP 409s rather than 500s:

```ts
// apps/admin/app/api/public/order/route.ts ≈1064-1080
if (err instanceof OutOfStock) {
  // 409, not 500: nothing was written (the txn rolled back) and the shopper can act on it.
  return bad(`Stok "${err.product}" tidak mencukupi (sisa ${err.available}).`, "items", 409);
}
if (err instanceof VoucherExhausted) {
  return bad(`Kuota voucher "${err.code}" baru saja habis. Hapus kodenya untuk melanjutkan.`, "discount", 409);
}
```

**Rollback protection is real and complete for everything inside step 10.** The audit found no path that writes an order row without its financials, its items or its stock movement.

### 2.3 Voucher engine — `applyDiscount`

`apps/admin/lib/promo.ts` is the single validator and pricer, called by both `/api/public/promo` (preview) and `/api/public/order` (charge), which is what makes "the shopper is charged exactly what they were shown" true.

```ts
// apps/admin/lib/promo.ts (tail)
if (d.usageLimit != null && d.usedCount >= d.usageLimit) return { ok: false, error: "Kuota voucher sudah habis." };
if (opts.subtotal < d.minPurchaseIdr)
  return { ok: false, error: `Minimum belanja Rp${d.minPurchaseIdr.toLocaleString("id-ID")} untuk voucher ini.` };

let priceOff = 0, shipOff = 0;
if (d.kind === "persen")            priceOff = Math.min(opts.subtotal, Math.round((opts.subtotal * d.value) / 100));
else if (d.kind === "nominal")      priceOff = Math.min(opts.subtotal, d.value);
else if (d.kind === "gratis_ongkir") shipOff  = opts.shippingCost;
```

**Correct by construction:**

- `Math.min(opts.subtotal, …)` on both discount kinds means a discount can never exceed the goods subtotal → **no negative-total path**. A `nominal` voucher worth more than the cart clamps to the cart.
- `storeId` is in the `WHERE`. Since migration 0084 codes are unique **per store** (`packages/db/src/schema.ts:1218` — `unique().on(t.storeId, t.code)`), this filter is the only thing preventing cross-tenant redemption. `AGENTS.md:931-933` flags it as load-bearing; the audit confirms it is present and correct.
- `gratis_ongkir` sets `shipOff = shippingCost` — the **server-quoted** shipping, not a client claim.

**The quota race is handled at the right layer.** `applyDiscount` reads `used_count` outside any transaction, so it is advisory: N concurrent orders on the last slot all pass it. The real lock is the conditional update inside the order transaction:

```ts
// apps/admin/app/api/public/order/route.ts ≈1035-1050
const bumped = await tx.update(schema.discounts)
  .set({ usedCount: sql`${schema.discounts.usedCount} + 1` })
  .where(and(
    eq(schema.discounts.id, appliedDiscountId),
    sql`(${schema.discounts.usageLimit} is null or ${schema.discounts.usedCount} < ${schema.discounts.usageLimit})`,
  ))
  .returning({ id: schema.discounts.id });
if (!bumped.length) throw new VoucherExhausted(appliedDiscountCode);
```

The loser of the race updates zero rows, throws, and the **entire order rolls back**. This is the correct pattern — the predicate is re-evaluated under the row lock the `UPDATE` itself takes.

**What is missing:** `discount_usages` records *that* a discount was used on an order, but carries **no customer identity and no unique constraint**:

```ts
// packages/db/src/schema.ts:1220-1226
export const discountUsages = pgTable("discount_usages", {
  id: pk(),
  discountId: uuid().notNull().references(() => discounts.id),
  orderId: uuid().references(() => orders.id),
  usedAt: createdAt(),
});
```

There is no `customer_id`, no `unique().on(discountId, customerId)` and no `unique().on(discountId, orderId)`. **A per-customer redemption limit does not exist anywhere in the system** — only the global `usage_limit`. One buyer can consume an entire campaign quota (see PAY-09).

### 2.4 Price, tax and fee computation

`packages/lib/src/order-finance.ts` is the canonical calculator and is well-designed: every input is coerced through `idr()` (`Math.max(0, Math.round(value ?? 0))`, guarding `NaN`/`Infinity`), and every derived figure is clamped.

```ts
// packages/lib/src/order-finance.ts ≈50-102
const shippingDiscountIdr = Math.min(shippingListIdr, idr(input.shippingDiscountIdr));
const salesTaxAddedIdr    = Math.min(salesTaxLiabilityIdr, idr(input.salesTaxAddedIdr));
const goodsProceedsIdr    = Math.max(0, subtotalIdr - goodsDiscountIdr - includedSalesTaxIdr);
const orderPayableBeforeCodIdr = subtotalIdr - goodsDiscountIdr + salesTaxAddedIdr + shippingChargedIdr;
const codFeeBeforeVatIdr = input.paymentKind === "cod" ? Math.round((orderPayableBeforeCodIdr * 0.03) / 0.97) : 0;
const codFeeVatIdr       = input.paymentKind === "cod" ? Math.round(codFeeBeforeVatIdr * 0.11) : 0;
const orderPayableIdr    = orderPayableBeforeCodIdr + codFeeBeforeVatIdr + codFeeVatIdr;
const gatewayFeeIdr      = input.paymentKind === "cod" ? 0 : idr(input.gatewayFeeIdr);
return { …, buyerPayableIdr: orderPayableIdr + gatewayFeeIdr };
```

The `0.03 / 0.97` grossing-up is the mathematically correct way to make a 3% COD fee land on the *collected* amount rather than the pre-fee amount. The separation of `sellerEntitlementIdr` (what the merchant earns) from `buyerPayableIdr` (what the shopper pays) with `shippingDeltaIdr` split into `sellerShippingDebitIdr` / `platformShippingMarginIdr` is a genuinely mature revenue model.

**The rates are hard-coded literals**, not configuration: `0.03`, `0.97`, `0.11` in `order-finance.ts`; and the PSP fee table in `packages/lib/src/payment-fees.ts`:

```ts
export const PAYMENT_FEES: Record<FeeKind, Fee> = {
  va:      { kind: "va",      label: "Virtual Account (semua bank)", type: "flat", value: 4_000, note: "Rp4.000 / transaksi" },
  ewallet: { kind: "ewallet", label: "E-Wallet (OVO, DANA, ShopeePay, dll)", type: "pct", value: 0.024, note: "2,4% / transaksi" },
  qris:    { kind: "qris",    label: "QRIS", type: "pct", value: 0.01, note: "1% / transaksi" },
  retail:  { kind: "retail",  label: "Minimarket (Indomaret, Alfamart)", type: "flat", value: 4_000, note: "Rp4.000 / transaksi" },
};
```

The hard-coded `0.11` VAT is the specific compliance risk: Indonesian VAT policy moved during 2025, and a rate change becomes a code deployment plus a migration of every historical `order_financials` interpretation rather than a configuration change (see PAY-14).

`packages/lib/src/tax.ts` (`computeTax`) is correct and correctly separated from platform billing PPN: inclusive tax breaks the portion out of an unchanged total; exclusive tax adds on top and returns `addToTotal`.

### 2.5 Payment channels and the AutoLaris client

Channel availability is a **platform** decision (ADR 0004): `platform_payment_channels` is owned by super-admin, and the storefront reads it via `enabledPaymentChannels()` (`apps/storefront/src/data/catalog.ts:767`), cached under `platform:payment-channels`. The client-admin "Pembayaran" tab was removed. `packages/lib/src/autolaris.ts` keeps `AUTOLARIS_KNOWN_CHANNELS` (17 entries across `va`/`qris`/`ewallet`/`retail`) for probing, and `PAYMENT_CHANNELS` for what is live.

The route does **not** trust the storefront's channel list — it re-validates server-side, and the commentary records why:

> `// The hole that opened: POST channelCode:"ALFAMART" passed this gate, the order was written and`
> `// stock decremented, THEN alCreatePayment came back rc=07 — and the response is a 200 carrying`
> `// payError, so checkout.astro treats it as settled and renders the success page.`

`alCreatePayment` itself is a thin, correct mapper over the H2H API:

```ts
// packages/lib/src/autolaris.ts
async function al<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return (await res.json()) as T;
}
```

Three properties of this function are load-bearing and none of them are defended: **there is no `AbortSignal`/timeout**, **`res.ok` is never consulted**, and **`res.json()` is unguarded** so a non-JSON error page throws. The third is compensated at the single most important call site (the order route wraps it in `try/catch`), but not at the others.

### 2.6 Callback verification

`apps/admin/app/api/public/pay/callback/route.ts` is the endpoint that turns a webhook into money. Its authentication is a shared secret compared in constant time, failing **closed** in production:

```ts
function secretOk(provided: string | null): boolean {
  const expected = process.env.AUTOLARIS_CALLBACK_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      console.error("[pay/callback] AUTOLARIS_CALLBACK_SECRET unset in production — REJECTING callback.");
      return false;
    }
    return true;              // dev only: lets the flow be exercised offline
  }
  if (!provided) return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

The order of operations in `POST` is correct: rate limit → secret → capped body read → parse. The state machine is the strongest part of the file:

```ts
const mapped = status === "PAID" ? "berhasil" : status === "EXPIRED" ? "gagal" : null;
…
const rows = await db.update(schema.payments)
  .set({ status: mapped, paidAt: mapped === "berhasil" ? new Date() : null })
  .where(and(match, ne(schema.payments.status, mapped), ne(schema.payments.status, "berhasil")))
  .returning({ id: schema.payments.id, orderId: schema.payments.orderId });
```

`ne(status, "berhasil")` is **forward-only out of collected**: a late or replayed `EXPIRED` cannot walk a collected payment back to `gagal`. Two further guards are present and correct:

- The order sync refuses terminal orders — `notInArray(schema.orders.status, ["batal", "retur"])` — and logs loudly when a PAID callback lands on a cancelled order (money collected, not credited, needs a refund decision).
- Conversion release iterates `matched` (everything the callback is *about*) rather than `rows` (what *transitioned*), so a failed release is recoverable on the PSP's retry. `releasePurchase` is idempotent.
- Ledger credit iterates `rows` and is protected by `ledger_one_sale_per_payment` (`packages/db/drizzle/0041_ledger_credit_sale.sql:29`) **and** by `creditSaleForPayment`'s own `not exists (… l.payment_id = p.id or l.order_id = o.id)` predicate (`apps/admin/lib/ledger-credit.ts:68-71`), plus `ledger_one_sale_per_order` (`0040_ledger_payouts.sql:74`).

The subscription-billing branch of the same callback extends `stores.current_period_end` from `max(now, current_period_end)` by the invoice's `period_months` — correct, non-truncating renewal arithmetic.

### 2.7 Idempotency inventory

| Layer | Mechanism | Where | Strength |
|---|---|---|---|
| Duplicate checkout submit | `checkout_sessions` unique `(store_id, session_id)` joined to `orders`; returns `code: "order_already_created"` | `order/route.ts:288-310` | Strong **iff** the client sends a stable `sessionId` |
| Client double-click | `settled` / `submitting` flags in the inline script | `checkout.astro` ≈2665 | Advisory (UI only) |
| Gateway bill per order | `reffId = order.number` | `order/route.ts:1212` | Unique per order — but **not enforced by an index** |
| Callback replay | `ne(status, mapped)` + `ne(status, "berhasil")` | `pay/callback/route.ts` ≈100 | Strong |
| Ledger double-credit | `ledger_one_sale_per_payment`, `ledger_one_sale_per_order` (partial unique indexes) + `not exists` predicate | `0040`/`0041` migrations, `ledger-credit.ts` | **Strongest layer in the system** |
| Retur/cancel double-refund | `ledger_one_retur_per_order` | `0040_ledger_payouts.sql:75` | Strong |
| Manual merchant bill | Read `payments` for `menunggu`/`berhasil`, then insert | `actions/payments.ts:52-67` | **Check-then-act — not atomic** |
| COD collection | `where … status = 'menunggu'` returning ids | `ledger-credit.ts:89-90` | Strong |

---

## 3. Edge Case, Regression & Vulnerability Assessment

Each finding below states the mechanism, the exact evidence, the reachable scenario, and the blast radius. Severity uses: **P0** = money can be lost, stolen or double-collected; **P1** = integrity/availability degradation or disclosure with commercial value; **P2** = correctness, maintainability or reconciliation debt.

---

### PAY-01 — Callback authorization is a static bearer secret in a URL query string — **P0**

**Mechanism.** The callback URL handed to the PSP embeds the shared secret as a query parameter:

```ts
// packages/lib/src/pay-callback.ts
export function payCallbackUrl(): string {
  const base = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${base}/api/public/pay/callback`;
  const secret = process.env.AUTOLARIS_CALLBACK_SECRET;
  // No secret = local dev, where the endpoint deliberately accepts an unauthenticated callback…
  return secret ? `${url}?token=${encodeURIComponent(secret)}` : url;
}
```

The module's own header explains that this exists because `alCreatePayment` sends `callback_url` as a plain string with no header channel — *"there was no other way for the token to travel"*. That is an honest description of a real constraint, and it is also a precise description of the risk.

**Evidence.**

- `packages/lib/src/pay-callback.ts` — secret appended as `?token=`.
- Four independent call sites hand this URL to the third party: `apps/admin/app/api/public/order/route.ts:1219`, `apps/admin/lib/actions/billing.ts:86-89`, `apps/admin/app/api/cron/billing/route.ts:93-97`, `apps/super-admin/lib/actions.ts:691-692`.
- `apps/admin/app/api/public/pay/callback/route.ts:48-52` — accepted from **either** `X-Callback-Token` **or** `?token=`.
- `.env.example:28-29` — *"Shared secret guarding /api/public/pay/callback (interim, until AutoLaris HMAC spec confirmed). MUST be set in production — without it the callback that marks orders PAID is unverified."*

**Reachable scenario.** The secret is (a) identical for every store, every order and every invoice on the platform; (b) transmitted to a third-party system that stores it in its merchant configuration and in its outbound-webhook logs; (c) present in the URL, so it is captured by every reverse proxy access log, CDN log, browser referrer chain (if the URL ever reaches a browser), and error-tracking breadcrumb along the path; (d) never rotated — nothing in the repository rotates it, and rotating it would require re-registering every outstanding bill's callback URL.

Anyone who obtains it can `POST {"reff_id": "<order number>", "status": "PAID"}` and:

1. flip any prepaid order to `financial_status = 'dibayar'`;
2. cause `creditSaleForPayment` to credit the merchant's ledger for goods never paid for;
3. mark any subscription invoice paid and extend `stores.current_period_end` — free SaaS, indefinitely.

**Mitigating factor (measured, not assumed).** Order numbers are `"PHI-" + Date.now().toString().slice(-9) + base36(random(46656)).padStart(3,"0")` (`order/route.ts:899-906`) — roughly 46,656 candidates per millisecond, so blind enumeration of a *specific* order is expensive. But a buyer always knows **their own** order number, so the secret alone separates a shopper from marking their own unpaid VA order paid.

**Blast radius.** Platform-wide. Compromise is silent: a forged PAID leaves an ordinary-looking order and an ordinary-looking ledger credit.

---

### PAY-02 — The callback performs no amount, currency or inquiry verification — **P0**

**Mechanism.** The webhook body is treated as fact. The route reads four scalars and acts:

```ts
let body: { trx_id?: string; reff_id?: string; status?: string; paid_at?: string } = {};
…
const status = (body.status ?? "").toUpperCase();
const mapped = status === "PAID" ? "berhasil" : status === "EXPIRED" ? "gagal" : null;
```

Nothing compares the callback against `payments.amount_idr` or `payments.total`; nothing calls back to AutoLaris to *ask* whether the transaction is genuinely settled. Note that `body.paid_at` is destructured and **never used** — `paidAt` is set to `new Date()` instead, so the platform's record of *when* money arrived is the moment the webhook was processed, not the moment of payment.

**Evidence.** `apps/admin/app/api/public/pay/callback/route.ts:57-101`. `packages/lib/src/autolaris.ts` exposes only `alCreatePayment`, `alProbeChannels`, `alTestConnection` — **there is no status-inquiry function in the client at all**, so verification is not merely skipped, it is not implementable without new code.

**Reachable scenario.** Any underpayment, partial settlement or amount mismatch reported by the PSP is accepted as full settlement. Combined with PAY-01, a single leaked string is *sufficient* authorization to mint money in the merchant ledger — there is no second factor to fail.

**Blast radius.** Every prepaid order and every subscription invoice.

---

### PAY-03 — `payments.reff_id` is not unique; the callback updates every match — **P0**

**Mechanism.** The lookup indexes added in migration 0085 are deliberately **non-unique**:

```sql
-- packages/db/drizzle/0085_payment_lookup_indexes.sql:7-8
create index if not exists payments_trx_idx  on payments (trx_id)  where trx_id  is not null;
create index if not exists payments_reff_idx on payments (reff_id) where reff_id is not null;
```

The callback matches with `or(eq(trxId, trx), eq(reffId, reff))` and issues a set-based `UPDATE` with no row limit — so **all** rows sharing a `reff_id` transition together.

The only thing preventing two live bills for one order is application code, and it is a check-then-act sequence across two separate connections with no transaction and no constraint:

```ts
// apps/admin/lib/actions/payments.ts:52-67
const live = await withTenant(storeId, async (db) => {
  const [p] = await db.select({ status: schema.payments.status })
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, order.id), inArray(schema.payments.status, ["menunggu", "berhasil"])))
    .limit(1);
  return p ?? null;
});
if (live) return { ok: false, error: … };

const r = await alCreatePayment({ reffId: order.number, … });   // ← network call between check and write
…
await withTenant(storeId, (db) => db.insert(schema.payments).values({ … }));
```

The file's own comment states the consequence exactly, and it remains true because the guard is not a constraint:

> `// Two live virtual accounts for one order are both payable and both match on reff_id = order.number`
> `// (there is no unique index on it): the buyer pays both, the platform collects twice,`
> `// ledger_one_sale_per_order credits the merchant once — correctly — and nothing anywhere records`
> `// the money owed back.`

**Reachable scenario.** Two concurrent dispatches of the `"use server"` action `createOrderPayment` (double-click, retried mutation, two operators on the same order) both read `live = null` — the window is a full PSP round-trip wide, hundreds of milliseconds — and both insert. A second, independent path exists: an order whose first bill went `gagal` (cancel → re-open) can legitimately grow a second row with the same `reff_id`.

**Confirmed downstream behaviour.** When one PAID callback flips both rows, `creditSaleForPayment` credits **once**, because its predicate excludes an order that already has a sale entry:

```sql
-- apps/admin/lib/ledger-credit.ts:68-71
and not exists (
  select 1 from ledger_entries l
   where l.kind = 'sale' and (l.payment_id = p.id or l.order_id = o.id)
)
```

So there is **no crash and no double credit** — which is worse, not better: the platform holds two collections, the merchant is credited for one, and **no row anywhere records the refund obligation**. The discrepancy is invisible to every screen.

**Blast radius.** Per-order double collection with no audit trail.

---

### PAY-04 — Abandoned prepaid orders hold stock forever — **P0**

**Mechanism.** Inventory is decremented inside the order transaction, at order creation — correct for oversell protection. But the compensating release exists **only** on a merchant-driven status change:

```ts
// apps/admin/lib/order-status.ts:82-84
.update(schema.inventoryLevels)
.set({ available: sql`${schema.inventoryLevels.available} + ${l.qty}` })
.where(eq(schema.inventoryLevels.id, invId));
```

The `EXPIRED` branch of the callback writes `payments.status = 'gagal'` and **nothing else**: the order stays `status = 'baru'`, `financial_status = 'pending'`, and its stock stays committed.

**Evidence.** The complete cron inventory is `apps/admin/app/api/cron/`: `domains/`, `tracking/`, `billing/`, `tracking-events/`. **There is no order-expiry, cart-expiry or stock-reclaim job.** `apps/admin/app/api/cron/tracking-events/route.ts:138-139` explicitly declines to touch unpaid VAs (*"Anything else (an unpaid VA) is correctly left alone"*) — correct for conversion tracking, but it confirms nothing else sweeps them either.

**Reachable scenario.** Ordinary abandonment. A VA lives 24 hours (`alCreatePayment` sets `expiresAt = now + 24h`). Every shopper who opens a VA and does not pay permanently removes their quantity from sellable stock. On a flash sale with a limited run, a handful of abandoned checkouts can zero the sellable inventory of a product that has sold nothing.

**Secondary effect.** `orders` accumulates permanently-`baru` rows that pollute the merchant's order list, the recovery funnel and every `count(*)` KPI.

**Blast radius.** Silent, cumulative, merchant-visible as "stock is wrong" with no diagnosable cause. This is the highest-probability P0 in the batch: it requires no attacker, only ordinary shopper behaviour.

---

### PAY-05 — No timeout on the gateway call, executed after the commit — **P1**

**Mechanism.** `al()` calls `fetch` with no `signal` and no `AbortController`. The order route invokes it **after** the transaction has committed:

```ts
// apps/admin/app/api/public/order/route.ts:1209-1225
let pay: Awaited<ReturnType<typeof alCreatePayment>>;
try {
  pay = await alCreatePayment({ reffId: order.number, channelCode, amount: total, … });
} catch (err) {
  console.error("[order] alCreatePayment threw for", order.number, err);
  pay = { ok: false, error: PAY_START_FAILED };
}
```

The `try/catch` is correct and was added for exactly this class of failure (the route documents the double-charge it caused). But `catch` only helps once the promise settles. With no timeout, a PSP that accepts the connection and never responds holds the request open until the runtime's default header timeout — on the order of minutes — while the shopper stares at a spinner on a checkout whose stock is already committed.

**Reachable scenario.** PSP degradation (not outage). The shopper reloads or resubmits; the `sessionId` replay guard returns `order_already_created`, which is the correct answer — so the damage is bounded to a held Node request, a held DB pool slot and a very poor experience. Under sustained PSP slowness, concurrent held requests exhaust the connection pool and take the whole admin app down with them.

**Same defect, worse exposure:** `alProbeChannels` (`packages/lib/src/autolaris.ts:53-73`) loops **17 channels sequentially**, each an untimed real `create_payment`. One hung channel hangs the whole super-admin probe (PAY-16).

---

### PAY-06 — Bill expiry is built from unzoned local server time — **P1**

**Mechanism.**

```ts
// packages/lib/src/autolaris.ts
// expired: default +24h, format YYYYMMDDHHMMSS
function expiryStamp(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
```

`getHours()` and friends render **container-local** time. The wire format carries **no offset**, so the PSP must assume one — for an Indonesian gateway, almost certainly WIB (UTC+7).

**Evidence.** No `TZ` variable appears in `docker-compose.yml`, `.env.example` or `.env.coolify.example` (searched; zero matches for `TZ=`, `timezone`, `Asia/Jakarta`). Container defaults are UTC.

**Consequence if the PSP reads WIB.** A bill created at 10:00 WIB (03:00 UTC) is stamped `…03 00 00` for "tomorrow 03:00", which the PSP reads as 03:00 WIB — **the VA dies 7 hours early**, at 17 h instead of 24 h. Meanwhile `AlPayment.expiresAt` returned to the browser is a correct ISO instant (`new Date(Date.now() + 24h)`), so **the success page displays a deadline the bill will not honour**: `apps/storefront/src/pages/checkout/sukses.astro` renders `pay.expiresAt` verbatim.

**Status.** The mismatch between the two clocks is confirmed in code. Which clock AutoLaris applies is **not verifiable from this repository** and must be confirmed against the vendor's H2H specification (see §5.6).

---

### PAY-07 — Six payment channels are persisted as `method = 'va'` — **P1**

**Mechanism.** Both persistence paths collapse the instrument:

```ts
// apps/admin/lib/actions/payments.ts:10-11
const channelToMethod = (code: string): "va" | "qris" | "dana" =>
  code === "QRIS" ? "qris" : code === "DANA" ? "dana" : "va";
```

The order route applies the same three-way mapping (`payMethod = channelCode === "QRIS" ? "qris" : channelCode === "DANA" ? "dana" : "va"`). `AUTOLARIS_KNOWN_CHANNELS` contains **17** codes; six of them — `OVO`, `SHOPEEPAY`, `LINKAJA`, `GOPAY`, `ALFAMART`, `INDOMARET` — are neither QRIS nor DANA and are therefore written to the database as **Virtual Account**.

**This is not a schema limitation.** `packages/db/src/schema.ts:104-112` defines `payment_method` with dedicated members beyond `va`/`qris` (including `ovo`), so the enum can already express what the mapper discards.

**Consequence.** `payments.method` is unreliable for reconciliation, for per-instrument fee attribution (`PAYMENT_FEES` prices `ewallet` at 2.4% but `va` at a flat Rp4.000 — the row says `va` while the platform was charged a percentage), and for any "how do our shoppers pay?" analysis. `channel_code` is stored alongside and is correct, so **the data is recoverable** — but every consumer must know to ignore `method`, which is precisely the kind of trap that produces a wrong financial report a year later.

---

### PAY-08 — Rate limiting is per-process and in-memory — **P1**

**Mechanism.**

```ts
// packages/lib/src/cache.ts:39-41
// PROD SWAP: Cloudflare Rate Limiting (edge) / Workers KV / Upstash — same intent.
const hits = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) { … }
```

Applied as: `/api/public/order` → 10/min/IP (`order/route.ts:169`); `/api/public/pay/callback` → 60/min/IP; `/api/public/promo` → 30/min/IP.

**Consequences.** (1) The effective limit is `limit × replicas` — horizontal scaling silently loosens every money endpoint. (2) Every deploy resets all counters. (3) The two Node apps (`admin`, `storefront`) do not share the map. (4) `clientIp()` reads proxy headers (Cloudflare first, then standard forwards); if the origin is ever reachable without passing the proxy, the header is attacker-controlled and the limit is per-*claimed*-IP. The comment marks this as a known production swap; the audit records that **the swap has not happened**, and it now gates a payment webhook.

---

### PAY-09 — No per-customer voucher redemption limit exists — **P1**

**Mechanism.** See §2.3. `discount_usages` stores `(discountId, orderId, usedAt)` with no `customer_id` and no unique constraint. `applyDiscount` checks only the global `usage_limit`, and the order transaction enforces only that same global counter.

**Reachable scenario.** A shopper (or a coordinated group) places N orders against a `GAJIAN50` campaign and consumes the entire quota. Because there is no customer dimension in the usage table, the merchant cannot even *detect* it after the fact without joining back through `orders`. For a `nominal` voucher this is a direct, unbounded margin leak; for `gratis_ongkir` it is an unbounded shipping-cost leak, since `shipOff = opts.shippingCost` waives the full server-quoted ongkir every time.

**Aggravating factor.** `discounts.used_count` is incremented once per order, not per unit — correct — but with no per-customer cap the counter measures campaign exhaustion, not campaign reach.

---

### PAY-10 — The public promo oracle discloses exact thresholds cross-origin — **P1**

**Mechanism.** `/api/public/promo` is side-effect free, CORS `*`, 30/min/IP, and answers **against any store**. `applyDiscount` returns six distinguishable outcomes, one of which leaks a number:

```ts
return { ok: false, error: `Minimum belanja Rp${d.minPurchaseIdr.toLocaleString("id-ID")} untuk voucher ini.` };
```

**Evidence.** Already recorded in `specs/docs/tasks/NEXT.md:1097-1101`; this audit confirms it is still live and now cross-references it as a payment-domain issue, not merely an SEO/marketing one. `AGENTS.md:931-933` documents the sibling risk (per-store code uniqueness is the only cross-tenant lock).

**Reachable scenario.** A competitor enumerates common Indonesian promo codes (`GAJIAN`, `DISKON10`, `GRATISONGKIR`, `HEMAT25`) against a rival's store slug at 30/min and reconstructs the entire live campaign calendar — code, kind, validity window (from the *not yet valid* vs *expired* distinction) and **exact minimum-purchase threshold**. This is commercial intelligence, cheaply obtained, with no login and no attribution.

---

### PAY-11 — Wildcard CORS on the order-creating endpoint — **P1**

```ts
// apps/admin/app/api/public/order/route.ts:63-67
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
```

The endpoint is unauthenticated by design (headless storefronts, custom merchant domains), so this is a deliberate architectural choice rather than an oversight, and CSRF is not the concern (there is no session to ride). The concern is that **no Origin allow-list exists at all**: any page anywhere can create real orders against any store at 10/min/IP, each one decrementing real stock (PAY-04 makes that decrement permanent). The custom-domain registry (`stores.primaryHost`, `tokophi-custom-domains.yaml`) already enumerates every legitimate origin, so an allow-list is available data, not new data.

---

### PAY-12 — `feeMismatch` is surfaced but never persisted or alerted — **P2**

The route computes the expected PSP fee from the platform table, stores it on the order (`order_financials.expected_gateway_fee_idr`, `schema.ts:1003`), then compares it to what the PSP actually charged:

```ts
// apps/admin/app/api/public/order/route.ts:1317-1321
gatewayFeeExpected: finance.gatewayFeeIdr,
gatewayFeeActual: actualGatewayFee,
buyerPayable: actualBuyerPayable,
feeMismatch: actualGatewayFee !== finance.gatewayFeeIdr,
```

`checkout.astro:2726-2728` reads all three back and corrects the displayed total — so **the shopper is always shown the truth**, which is the important half. But `feeMismatch` exists only in that one HTTP response: it is not written to any table, not counted, not alerted. A PSP silently changing its fee schedule would be discovered by a human noticing a margin drift, months later. The reconciliation inputs are all present (`expected_gateway_fee_idr` on the order, `admin_fee` on the payment) — what is missing is anything that compares them in aggregate.

---

### PAY-13 — Gateway enrichment happens outside the transaction — **P2**

The payment shell is created inside the order transaction (correct — an order can never exist without a payment row); the gateway's `trx_id`, VA number, QR payload and fees are written by a separate `UPDATE` after the PSP responds. The route documents the intended failure mode:

> `// If this UPDATE were to fail, the order still has its payment row (pending) and the callback can`
> `// still match it by reffId — no orphaned order, no double bill on retry.`

That reasoning is sound **and depends entirely on `reff_id` matching being reliable** — which PAY-03 shows it is not, once a second row can share the value. The two findings compound: lose the `trx_id` write, and the callback's only remaining handle is the non-unique column.

---

### PAY-14 — Tax and fee rates are hard-coded literals — **P2**

`0.03`, `0.97` and `0.11` are inline in `packages/lib/src/order-finance.ts`; the PSP fee schedule is a frozen `Record` in `packages/lib/src/payment-fees.ts`. Merchant-facing PPN is correctly configurable (`store_settings`, consumed by `computeTax`), so the pattern for configuration already exists — it simply was not applied to the platform's own COD fee VAT. An Indonesian VAT rate change becomes a code change, a redeploy, and an ambiguity about which historical orders used which rate (nothing on `order_financials` records the rate that produced `cod_fee_vat_idr`).

---

### PAY-15 — The money engine is duplicated in browser JavaScript — **P2**

`checkout.astro` carries a complete second implementation of the pricing rules in its inline script — `ppnAdd()`, `taxableGoods()`, `autoFreeShip()`, `shipWaived()`, `totalDisc()`, `codCharges()` — and `OrderFunnel.astro` carries a third, ported by hand (its header says so: *"The client logic … is ported verbatim from checkout.astro"*).

The design is defensible: the server response overwrites the display before the shopper commits, and the code is scrupulous about saying so (*"the SERVER priced it … the page must show what the order actually says, not what this tab last calculated"*). The duplication is nonetheless a standing regression surface — `shipWaived`'s `Math.max(Math.min(voucherShipOff, ship), autoFreeShip(ship))` (preventing a `gratis_ongkir` voucher and auto-free-shipping from stacking) is a subtle rule that now exists in three places and is pinned by tests in **none**.

---

### PAY-16 — `alProbeChannels` mints 17 real bills, sequentially, untimed — **P2**

Each probe is a real `create_payment` that creates a real (sandbox or live) bill; the function is correctly documented as EXPENSIVE and super-admin-only, but nothing enforces that, there is no concurrency, no timeout and no cleanup of the bills it creates. `alTestConnection` similarly mints a Rp10.000 QRIS bill on every connectivity check.

---

### PAY-17 — Replay idempotency depends on a client-generated session id — **P2**

The strong duplicate-order guard keys on `checkout_sessions.session_id`, and that id is minted **in the browser**:

```js
// apps/storefront/src/pages/checkout.astro:1025-1033
var SID_KEY = "tphi:sid";
function sid() {
  try {
    var v = sessionStorage.getItem(SID_KEY);
    if (v) return v;
    v = crypto && crypto.randomUUID ? crypto.randomUUID() : "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(SID_KEY, v);
    return v;
  } catch (e) { return ""; }
}
```

A client that omits `sessionId`, rotates it, or runs with `sessionStorage` unavailable (the `catch` returns `""`) is **unguarded** — the lookup at `order/route.ts:288` has nothing to match. For a first-party browser this is fine; for the endpoint's actual trust boundary (unauthenticated, CORS `*`), it means the anti-replay property is opt-in by the caller. It is also the private-browsing / storage-blocked path for real shoppers, where a double submit produces two genuine orders.

---

### 3.1 Verified non-issues (regression guards that hold)

These were probed and found **correctly defended** — recorded so future work does not "fix" them into breakage:

| Probe | Result | Guard |
|---|---|---|
| Client sends a forged item `price` | Rejected — server re-prices from `product_variants` + `activeFlashPrices` | `order/route.ts` item resolution loop |
| Client sends a forged `shipping.cost` | Rejected — *"cost is deliberately NOT read — the price is re-quoted below"*; `findRate` must match courier **and** service type | `order/route.ts:180-330`, `≈600-720` |
| Renamed/removed variant silently substituted | Rejected — exact-title match required, order refused rather than substituted | `order/route.ts:434-448` |
| COD forced by posting `channelCode:"cod"` | Rejected 403 — five switches re-evaluated server-side; province **derived** from `destId`, never from the typed field | `order/route.ts:724-763`, `lib/cod-policy.ts` |
| Voucher over-redemption at the quota edge | Rejected — conditional `UPDATE`, whole order rolls back with 409 | `order/route.ts:1035-1050` |
| Discount exceeding cart value → negative total | Impossible — `Math.min(subtotal, …)` on both kinds | `lib/promo.ts` |
| Cross-tenant voucher redemption | Rejected — `storeId` in the `WHERE` + `unique(storeId, code)` | `lib/promo.ts`, `schema.ts:1218` |
| Replayed `EXPIRED` after `PAID` | Rejected — forward-only `ne(status, "berhasil")` | `pay/callback/route.ts:≈100` |
| PAID callback on a cancelled order | Refused + logged for refund decision; ledger correctly declines | `pay/callback/route.ts:≈108-120`, `ledger-credit.ts:60-67` |
| Double ledger credit on callback retry | Impossible — two partial unique indexes plus a `not exists` predicate | `0040`/`0041` migrations |
| Double refund on cancel + retur | Impossible — `ledger_one_retur_per_order` | `0040_ledger_payouts.sql:75` |
| New live bill on a `batal`/`retur`/paid order | Refused | `actions/payments.ts:34-45` |
| Unbounded request body on public routes | Capped before parse | `lib/public-guard.ts` (`MAX_BODY_BYTES`) |
| PSP error text leaking to the shopper | Replaced with `PAY_START_FAILED`; provider brand never shown (ADR 0004) | `order/route.ts:86-95` |
| Gateway throw → CORS-less 500 → shopper retries → double order | Caught; returns 502 `payment_start_failed` with `orderCreated: true` | `order/route.ts:1209-1250` |

---

## 4. Test Suite Coverage & Regression Matrix

### 4.1 Inventory method

Every `*.test.ts` in the repository was enumerated (`packages/lib/src`, `packages/db/src`, `apps/admin/lib`, `apps/super-admin/lib`, `apps/storefront/src`, `test/`) and each was mapped to the payment-domain module it defends. `test/source-code.test.ts` — the repository's grep-based invariant suite — was searched for the terms `payment`, `callback`, `discount`, `voucher`, `checkout`, `autolaris`: **zero matches**. The payment domain has no source-level invariant pins.

### 4.2 Coverage by module

| Module | Role in the money path | Test file | Coverage |
|---|---|---|---|
| `packages/lib/src/order-finance.ts` | Canonical order money | `order-finance.test.ts` | **Covered** |
| `packages/lib/src/tax.ts` | Merchant PPN | `tax.test.ts` | **Covered** |
| `packages/lib/src/billing.ts` | Subscription quote/PPN/`addMonths` | `billing.test.ts` | **Covered** |
| `apps/admin/lib/cod-policy.ts` | Five-switch COD gate | `cod-policy.test.ts` | **Covered** — exemplary (cap boundary, `cap = 0`, negative total, province normalisation, non-COD service) |
| `apps/admin/lib/shipment-payment.ts` | COD vs VA shipment money direction | `shipment-payment.test.ts` | **Covered** — exemplary (includes an ADR-0004 brand-leak assertion) |
| `apps/admin/lib/ledger-credit.ts` | Money-in-hand → ledger | `ledger-credit.test.ts` | **Covered** (DB suite; skips without `TEST_DATABASE_URL`) |
| `apps/admin/lib/data/order-payment.ts` | "The order's payment" — one answer | `order-payment.test.ts` | **Covered** (DB suite; skips without `TEST_DATABASE_URL`) |
| `apps/admin/lib/payout.ts` | Payout arithmetic | `payout.test.ts` | **Covered** |
| `apps/admin/lib/public-guard.ts` | Body cap + IP + rate limit | `public-guard.test.ts` | **Covered** |
| `packages/lib/src/validate.ts` | Phone/name/email/address/postcode normalisation | `validate.test.ts` | **Covered** |
| `apps/storefront/src/lib/cart-variant.ts` | Cart line identity | `cart-variant.test.ts` | **Covered** |
| `apps/storefront/src/lib/checkout-kodepos.ts` | Postcode field behaviour | `checkout-kodepos.test.ts` | **Covered** |
| `packages/db/src/…` | Per-store code uniqueness, ledger verification | `per-store-codes.test.ts`, `verify-ledger.test.ts` | **Covered** |
| **`apps/admin/lib/promo.ts` (`applyDiscount`)** | **The voucher engine** | — | **NONE** |
| **`apps/admin/app/api/public/pay/callback/route.ts`** | **The endpoint that moves money** | — | **NONE** |
| **`apps/admin/app/api/public/order/route.ts`** | **The only order-creating endpoint** | — | **NONE** |
| **`packages/lib/src/autolaris.ts`** | **PSP client** | — | **NONE** |
| **`packages/lib/src/payment-fees.ts`** | **Platform fee table** | — | **NONE** |
| **`packages/lib/src/pay-callback.ts`** | **Callback URL + secret transport** | — | **NONE** |
| **`apps/admin/lib/actions/payments.ts`** | **Manual bill + duplicate guard** | — | **NONE** |
| **`checkout.astro` / `OrderFunnel.astro` client money engine** | **What the shopper sees** | — | **NONE** |

**Summary.** Coverage is **inverted with respect to risk**. Every pure function with a stable signature is well tested — often exemplary, with the failure that motivated each assertion documented in the test itself. Every module that touches the network, the transaction boundary or the webhook has **no test at all**. All four P0 findings sit in untested code.

### 4.3 Regression matrix — required scenarios

Priority: **R1** = must exist before the next payment-touching change; **R2** = should exist this quarter.

#### Voucher engine (`applyDiscount`) — pure, cheapest possible coverage

| # | Scenario | Expected | Pri |
|---|---|---|---|
| V-01 | Unknown code | `ok:false`, not-found message | R1 |
| V-02 | Code belonging to **another store** | `ok:false` — pins the `storeId` filter (`AGENTS.md:931`) | **R1** |
| V-03 | Case-insensitive match (`hemat25` → `HEMAT25`) | `ok:true` | R1 |
| V-04 | `status != aktif` | `ok:false`, inactive | R1 |
| V-05 | `startsAt` in the future | `ok:false`, not yet valid | R1 |
| V-06 | `endsAt` in the past | `ok:false`, expired | R1 |
| V-07 | **`endsAt = NULL`** | `ok:true` — pins "blank period = no end date" (`AGENTS.md:519-521`) | **R1** |
| V-08 | `usedCount >= usageLimit` | `ok:false`, quota | R1 |
| V-09 | `usageLimit = NULL` with high `usedCount` | `ok:true` — unlimited | R1 |
| V-10 | `subtotal < minPurchaseIdr` | `ok:false`, threshold message | R1 |
| V-11 | `subtotal == minPurchaseIdr` | `ok:true` — boundary is inclusive | R1 |
| V-12 | `persen` rounding (`value=33`, `subtotal=1000`) | `priceOff === 330`, `Math.round` semantics pinned | R1 |
| V-13 | `persen` `value=100` | `priceOff === subtotal`, never above | R1 |
| V-14 | `nominal` exceeding subtotal | clamped to subtotal, **total never negative** | **R1** |
| V-15 | `gratis_ongkir` | `shipOff === shippingCost`, `priceOff === 0` | R1 |
| V-16 | `gratis_ongkir` with `shippingCost = 0` | `shipOff === 0` | R2 |
| V-17 | `persen` with `value = 0` / negative stored value | no discount, never a surcharge | R2 |

#### Callback (`/api/public/pay/callback`)

| # | Scenario | Expected | Pri |
|---|---|---|---|
| C-01 | No token | 401 | **R1** |
| C-02 | Wrong token, correct length | 401 (constant-time path exercised) | **R1** |
| C-03 | Secret unset **and** `NODE_ENV=production` | 401 — pins fail-closed | **R1** |
| C-04 | Token via `X-Callback-Token` header | accepted | R1 |
| C-05 | `PAID` → payment `berhasil`, order `dibayar` | one transition | **R1** |
| C-06 | `PAID` replayed | second call transitions nothing; **exactly one ledger row** | **R1** |
| C-07 | `EXPIRED` **after** `PAID` | payment stays `berhasil`, `paid_at` intact | **R1** |
| C-08 | `PAID` on a `batal` order | `financial_status` unchanged; error logged; no ledger row | **R1** |
| C-09 | `PAID` on a `retur` order | as C-08 | R1 |
| C-10 | Unknown `status` string | no write, 200 | R1 |
| C-11 | Malformed / empty / form-encoded body | tolerated, no write, 200 | R1 |
| C-12 | Body over the cap | rejected before parse | R1 |
| C-13 | **Two payment rows sharing one `reff_id`** | pins PAY-03 — defines and asserts intended behaviour | **R1** |
| C-14 | Amount in callback ≠ `payments.amount_idr` | pins PAY-02 once verification is added | **R1** |
| C-15 | Subscription invoice PAID → `current_period_end` extended from `max(now, cpe)` | no truncation on early payment | R1 |
| C-16 | Subscription PAID replayed | period extended **once** | **R1** |
| C-17 | Over 60 calls/min from one IP | 429 | R2 |

#### Order endpoint (`/api/public/order`) — integration, against a throwaway DB

| # | Scenario | Expected | Pri |
|---|---|---|---|
| O-01 | Forged item `price` | server price wins; `subtotal` matches catalog | **R1** |
| O-02 | Forged `shipping.cost` | server re-quote wins | **R1** |
| O-03 | Service absent from the fresh quote | 400, never silently re-routed | **R1** |
| O-04 | Renamed variant | 400, never substituted | **R1** |
| O-05 | Qty exceeding stock | 409 `OutOfStock`, **nothing written** | **R1** |
| O-06 | Concurrent last-unit orders | exactly one succeeds; stock never negative | **R1** |
| O-07 | Concurrent last-slot voucher orders | exactly one succeeds; loser 409; `used_count` correct | **R1** |
| O-08 | Same `sessionId` submitted twice | second returns `order_already_created`, one order | **R1** |
| O-09 | **Missing `sessionId` submitted twice** | pins PAY-17 — documents that two orders result | **R1** |
| O-10 | COD posted where the gate refuses | 403, **no order row** | **R1** |
| O-11 | COD at exactly `maxAmountIdr` | accepted | R1 |
| O-12 | Gateway returns `rc != 00` | 502 `payment_start_failed`, `orderCreated: true`, order + pending payment exist | **R1** |
| O-13 | Gateway **throws** (network/HTML 502) | same shape as O-12, response carries CORS | **R1** |
| O-14 | Gateway **hangs** | pins PAY-05 once a timeout exists | **R1** |
| O-15 | Voucher + auto-free-ship together | ongkir waived once, never stacked | **R1** |
| O-16 | Exclusive PPN on discounted goods | tax base is `subtotal - voucherPriceOff` | **R1** |
| O-17 | Inclusive PPN | total unchanged; `includedSalesTaxIdr` broken out | R1 |
| O-18 | Response `total` == `order_financials.order_payable_idr` | display and record agree | **R1** |
| O-19 | Over 10 requests/min from one IP | 429 | R2 |
| O-20 | Body over the cap | rejected before parse | R2 |

#### PSP client (`autolaris.ts`) — against a stubbed `fetch`

| # | Scenario | Expected | Pri |
|---|---|---|---|
| A-01 | `rc="00"` with full `data` | mapped fields correct | R1 |
| A-02 | `rc="07"` (channel inactive) | `ok:false`, PSP `ket` **not** forwarded to the shopper | **R1** |
| A-03 | HTML 502 body | throws or `ok:false` — pin whichever is chosen | **R1** |
| A-04 | Response delayed past the timeout | aborts within budget | **R1** |
| A-05 | `expiryStamp` under a fixed clock and `TZ` | exact string — pins PAY-06 | **R1** |
| A-06 | Missing API key | `ok:false`, no network call | R2 |
| A-07 | `paymentFee(kind, amount)` for all four kinds incl. rounding | pins the fee table | R1 |

#### Client money engine (`checkout.astro`, `OrderFunnel.astro`)

| # | Scenario | Expected | Pri |
|---|---|---|---|
| U-01 | `shipWaived` with both a `gratis_ongkir` voucher and auto-free-ship | waived once | **R1** |
| U-02 | `codCharges` (3%/0.97 + 11%) | **identical to `calculateOrderFinance`** for the same inputs | **R1** |
| U-03 | `ppnAdd` / `taxableGoods` after a voucher | matches `computeTax` on `subtotal - voucherPriceOff` | **R1** |
| U-04 | Server response overwrites a stale client total | displayed total == `res.buyerPayable` | **R1** |
| U-05 | `feeMismatch: true` | corrected total shown, no stale figure | R2 |

> **Structural recommendation.** U-01–U-03 are only cheap if the shared arithmetic is extracted from the two `.astro` inline scripts into one importable module and the components consume it. That extraction is the single highest-leverage refactor in the batch: it deletes a duplicated implementation *and* makes the browser-side money testable for the first time.

### 4.4 Test-infrastructure observations

- The DB-backed suites (`order-payment.test.ts`, `ledger-credit.test.ts`) use a **transaction that is always rolled back** and **skip** when `TEST_DATABASE_URL` is unset, so a plain `vitest run` stays green. This is a sound pattern and should be the template for every new integration test above — but it means the ledger and payment-ordering guarantees are **not verified in a default local run or in CI unless the variable is set**. Confirm that CI sets it; if it does not, the strongest guarantees in the system are being asserted by nobody.
- `order-payment.test.ts` documents the exact reason a DB test was unavoidable: *"the two sites had orderings that differed by `nulls last`, which `tsc`, ESLint, `next build` and every existing test call identical — only Postgres … gives two different answers."* The same reasoning applies to C-06, C-13, O-06 and O-07, which are all concurrency or constraint behaviours that only Postgres can adjudicate.

---

## 5. Actionable Engineering Perfection Directives

Ordered by risk-adjusted value. Each directive states the change, the acceptance criterion, and the regression rows that must go green.

### 5.1 Security — P0

**D-01 — Move the callback secret out of the URL and add a second factor.**
The interim design is documented as interim; it should now end. Two steps, in order:

1. **Immediately:** accept the token **only** via the `X-Callback-Token` header, and register the header with AutoLaris if their configuration supports it. If it does not, keep the query token but treat it as a *routing* credential, not an authorization one — which makes D-02 mandatory rather than merely advisable.
2. **Target state:** implement AutoLaris's HMAC signature verification (`PROD_PLAN §7`), computed over the raw body with a timestamp/nonce and a replay window. `readPublicBody` already returns the raw text, so the signature can be verified over exactly the bytes received — the hard part of HMAC verification is already solved.
   *Acceptance:* C-01–C-04 green; a callback carrying a valid token but an invalid signature is rejected; the secret no longer appears in any URL emitted by `payCallbackUrl()`.
   *Also:* add secret rotation support — accept **two** valid secrets during a rotation window so the value can be changed without invalidating outstanding bills.

**D-02 — Verify the payment before believing it.**
Add `alInquiryPayment(trxId)` to `packages/lib/src/autolaris.ts` and call it from the callback before any state transition. Reject the transition if the gateway does not confirm settled status **and** an amount `>= payments.total`. Persist `body.paid_at` (parsed, validated) into `paidAt` instead of `new Date()`, falling back to now only when absent.
*Acceptance:* C-05, C-14 green; a forged `{"status":"PAID"}` with a valid token changes nothing.

**D-03 — Make the duplicate-bill guard a database constraint.**
Add a **partial unique index** that permits at most one non-terminal bill per order:

```sql
create unique index if not exists payments_one_live_per_order
  on payments (order_id)
  where status in ('menunggu', 'berhasil');
```

Then make `createOrderPayment` and the order route rely on the constraint (catch the unique violation and return the existing bill) rather than on a prior `SELECT`. Backfill check required first: identify orders that already violate it. Additionally, give the callback a deterministic target — prefer `trx_id` when present and fall back to `reff_id` only when it is not, instead of `or(...)` across both.
*Acceptance:* C-13, O-12 green; two concurrent `createOrderPayment` calls produce exactly one gateway bill.

**D-04 — Reclaim abandoned prepaid orders.**
Add `apps/admin/app/api/cron/order-expiry/route.ts`, following the existing cron conventions (`cronIntervalSec` + `recordCronRun`, `CRON_SECRET` guard). For each order that is `status = 'baru'`, `financial_status = 'pending'`, has no `berhasil` payment, and whose newest payment is `gagal` **or** older than the bill TTL: restock every line **inside one transaction**, mark the order `batal` with a machine-set reason, and let the existing `applyOrderStatusChange` claw-back path handle the ledger (it already inserts nothing when there is no sale row).
Reuse the restock statement at `apps/admin/lib/order-status.ts:82-84` rather than writing a second one — there must remain exactly one place that returns stock.
*Acceptance:* a VA order left unpaid past its TTL returns its stock and leaves the order list; running the job twice restocks once (guard on the status transition, as `setOrderStatus` already does).

**D-05 — Constrain who may create orders.**
Replace `Access-Control-Allow-Origin: *` with an allow-list derived from the store registry (`stores.primaryHost` + configured custom domains), echoing the request `Origin` when it matches and omitting the header when it does not. Keep `OPTIONS` correct for the allowed set.
*Acceptance:* a cross-origin `POST` from an unregistered host is rejected by the browser; every legitimate storefront (including custom domains) continues to work.

**D-06 — Stop the voucher oracle from disclosing thresholds.**
In `/api/public/promo` (not in `applyDiscount`, which the order path needs verbatim), collapse the six outcomes to two for unauthenticated cross-origin callers: valid-with-price, or a single generic "kode tidak berlaku". Preserve the specific messages for same-origin checkout use, where they are genuinely helpful. Tighten the limit below 30/min/IP for repeated failures.
*Acceptance:* an enumeration run cannot distinguish "expired" from "not found" from "below minimum", and cannot read `min_purchase_idr`.

### 5.2 Backend & transaction integrity — P1

**D-07 — Give every PSP call a deadline.**
Add `AbortSignal.timeout(ms)` inside `al()` — one place, every caller benefits. Suggested budgets: `create_payment` 8 s, inquiry 5 s, probe 5 s per channel. Check `res.ok` before `res.json()` and map a non-JSON body to `{ok:false}` rather than a throw. Run `alProbeChannels` with bounded concurrency.
*Acceptance:* A-03, A-04, O-14 green; a hung PSP fails the order's payment start within the budget and returns the existing, correct `payment_start_failed` response instead of holding the request.

**D-08 — Pin the expiry timezone.**
Confirm the vendor's interpretation of `expired` (see §5.6). Then either send an explicit offset if the API accepts one, or set `TZ=Asia/Jakarta` in the deployment configuration **and** make `expiryStamp` format explicitly in that zone rather than relying on the ambient default. Derive the `expiresAt` returned to the browser from the **same** computation, so the displayed deadline and the real one cannot diverge.
*Acceptance:* A-05 green under a fixed clock; the deadline on `sukses.astro` matches the bill.

**D-09 — Record the instrument that was actually used.**
Replace the two three-way `channelToMethod` mappers with one shared mapping from `channel_code` to the `payment_method` enum, using the members the enum already provides and falling back only for genuinely unknown codes. Backfill historical rows from `channel_code`, which was stored correctly throughout.
*Acceptance:* `select method, channel_code, count(*) from payments group by 1,2` shows no `va` row whose `channel_code` is an e-wallet or retail code.

**D-10 — Make rate limiting shared and durable.**
Execute the swap the code already names (`packages/lib/src/cache.ts:39`): move the public-endpoint limits to Cloudflare Rate Limiting at the edge, or to a shared store. Until then, treat the documented limits as **per replica** in capacity planning and say so in `DEPLOY.md`.
*Acceptance:* the limit holds across replicas and survives a deploy.

**D-11 — Persist and monitor the fee mismatch.**
Write `feeMismatch` (or the signed delta) to the payment row, and add it to the platform reconciliation view alongside `expected_gateway_fee_idr`. Alert when the daily count crosses a threshold.
*Acceptance:* PAY-12 becomes detectable within one day rather than one quarter.

### 5.3 Data model — P1

**D-12 — Add the customer dimension to voucher usage.**

```sql
alter table discount_usages add column customer_id uuid references customers(id);
create unique index if not exists discount_usages_one_per_order
  on discount_usages (discount_id, order_id);
-- and, when the feature ships:
alter table discounts add column per_customer_limit integer;
```

Enforce `per_customer_limit` the same way the global quota is enforced — in a conditional statement inside the order transaction, never by a pre-check alone. The advisory read in `applyDiscount` stays advisory; the lock lives in the write.
*Acceptance:* V-08/V-09 remain green; a new test proves the same customer cannot exceed their per-customer limit under concurrency.

**D-13 — Record the rates that produced each row.**
Add the COD-fee percentage and the VAT rate actually applied to `order_financials` (or a versioned platform-rate table keyed by effective date). A historical order must be re-derivable without knowing which deployment created it.
*Acceptance:* changing the VAT rate does not change the interpretation of a single existing row.

### 5.4 Frontend & UX — P1

**D-14 — Extract one money module and delete two copies.**
Move `ppnAdd`, `taxableGoods`, `autoFreeShip`, `shipWaived`, `totalDisc` and `codCharges` into a single browser-safe module in `packages/lib` that mirrors `calculateOrderFinance`'s contract, and have `checkout.astro` and `OrderFunnel.astro` import it. This is the prerequisite for U-01–U-03 and removes the standing drift risk described in PAY-15.
*Acceptance:* the anti-stacking rule for `gratis_ongkir` + auto-free-ship exists in exactly one place and is covered by a test.

**D-15 — Make the funnel's replay guard as strong as the cart's.**
Ensure `OrderFunnel.astro` mints and sends a `sessionId` on the same contract as `checkout.astro`, and make the server treat a **missing** `sessionId` as a hard 400 for browser-originated requests once every first-party client sends one. Handle the `sessionStorage`-unavailable path with an in-memory fallback so private browsing is guarded too.
*Acceptance:* O-08 and O-09 green; a double submit in private browsing produces one order.

**D-16 — Be honest about a bill that may already be dead.**
Once D-08 lands, `sukses.astro` should render the deadline as an absolute local time with the zone named ("Bayar sebelum 15 Agu 2026, 10:00 WIB"), and treat a past deadline as a distinct state with a "buat tagihan baru" path, rather than showing an expired VA as if it were payable.

### 5.5 Testing — P0 for the batch

**D-17 — Close the inversion.**
In priority order: **(1)** `promo.test.ts` (V-01–V-17, pure, no infrastructure, highest value per hour); **(2)** callback route tests C-01–C-12 with a stubbed `db`, then C-13/C-16 against the throwaway DB using the established rollback pattern; **(3)** `autolaris.test.ts` A-01–A-07 with a stubbed `fetch`; **(4)** order-route integration O-01–O-18. Confirm CI sets `TEST_DATABASE_URL` so the DB suites actually run.
*Acceptance:* every P0 finding above has a test that fails against today's code and passes after its directive lands.

### 5.6 Unresolved facts requiring external verification

These cannot be settled from the repository and must be confirmed before the corresponding directive is implemented:

1. **AutoLaris HMAC signing specification** — exact algorithm, canonical string, header name and replay window. Blocks D-01 step 2. (`.env.example:27-28` and the callback header both record this as pending vendor confirmation.)
2. **Timezone semantics of the `expired` field** — does the H2H API read `YYYYMMDDHHMMSS` as WIB, UTC, or the merchant account's configured zone? Blocks D-08.
3. **Whether a status-inquiry endpoint exists** on the H2H API, and its rate limits. Blocks D-02.
4. **Whether AutoLaris supports custom callback headers**, which decides whether D-01 step 1 can remove the query token immediately or must wait for D-01 step 2.
5. **Whether the deployed topology runs more than one replica** of the admin app. Determines whether PAY-08 is currently a real multiplier or only a future one.
6. **Whether CI sets `TEST_DATABASE_URL`.** Determines whether the ledger and payment-ordering guarantees are verified anywhere today.
7. **Underpayment behaviour of the PSP's closed-amount VAs** — whether a partial payment can produce a `PAID` callback at all. Bounds the practical severity of PAY-02.

---

## Appendix A — Evidence index

| Path | Lines cited | Subject |
|---|---|---|
| `apps/admin/app/api/public/order/route.ts` | 60-183, 288-310, 334-448, 429-623, 620-763, 785-1063, 893-963, 1035-1050, 1064-1080, 1199-1250, 1306-1342 | Order creation, guards, transaction, gateway call |
| `apps/admin/app/api/public/pay/callback/route.ts` | 1-177 (esp. 20-32, 40-148) | Callback auth, state machine, ledger + tracking release |
| `apps/admin/lib/promo.ts` | whole file | `applyDiscount` |
| `apps/admin/lib/actions/payments.ts` | whole file (esp. 34-45, 52-88) | Manual bill, duplicate guard |
| `apps/admin/lib/ledger-credit.ts` | 19-101, 136-206 | Sale credit, COD collection, claw-back |
| `apps/admin/lib/order-status.ts` | 82-84 | The one restock statement |
| `apps/admin/lib/cod.ts`, `cod-policy.ts` | whole files | Five-switch COD gate |
| `apps/admin/lib/public-guard.ts` | whole file | Rate limit, capped body, client IP |
| `apps/admin/app/api/cron/` | directory listing | Cron inventory (no expiry job) |
| `packages/lib/src/autolaris.ts` | 1-180 | PSP client, channels, probe, expiry stamp |
| `packages/lib/src/pay-callback.ts` | whole file | Callback URL + secret transport |
| `packages/lib/src/order-finance.ts` | 1-102 | Canonical order money |
| `packages/lib/src/payment-fees.ts` | whole file | Platform fee table |
| `packages/lib/src/tax.ts` | whole file | Merchant PPN |
| `packages/lib/src/cache.ts` | 7-8, 39-41 | In-memory cache + rate limiter |
| `packages/db/src/schema.ts` | 83-116, 1002-1005, 1200-1226, 1557-1561 | Enums, order financials, discounts, ledger |
| `packages/db/drizzle/0040_ledger_payouts.sql` | 73-77 | `ledger_one_sale_per_order`, `ledger_one_retur_per_order` |
| `packages/db/drizzle/0041_ledger_credit_sale.sql` | 28-32 | `ledger_one_sale_per_payment` |
| `packages/db/drizzle/0085_payment_lookup_indexes.sql` | 6-11 | Non-unique `reff_id` / `trx_id` indexes |
| `apps/storefront/src/pages/checkout.astro` | 1024-1060, 1279-1453, 2540-2759 | Session id, client money engine, submit handler |
| `apps/storefront/src/components/OrderFunnel.astro` | 1-235 | COD funnel, ported client logic |
| `apps/storefront/src/pages/checkout/sukses.astro` | 140-240 | Invoice, fees, payment instructions |
| `apps/storefront/src/data/catalog.ts` | 766-890 | Channel / tax / COD / free-ship loaders |
| `.env.example`, `.env.coolify.example` | 23-30 | PSP + callback secret configuration |
| `AGENTS.md` | 422, 519-537, 931-933 | ADR 0004, voucher doctrine, tenancy lock |
| `specs/docs/tasks/NEXT.md` | 1097-1101 | Promo oracle disclosure (prior art) |

## Appendix B — Directive-to-finding traceability

| Finding | Severity | Directive(s) | Regression rows |
|---|---|---|---|
| PAY-01 | P0 | D-01 | C-01–C-04 |
| PAY-02 | P0 | D-02 | C-05, C-14 |
| PAY-03 | P0 | D-03 | C-13, O-12 |
| PAY-04 | P0 | D-04 | new expiry-job suite |
| PAY-05 | P1 | D-07 | A-03, A-04, O-14 |
| PAY-06 | P1 | D-08, D-16 | A-05 |
| PAY-07 | P1 | D-09 | — (data assertion) |
| PAY-08 | P1 | D-10 | O-19, C-17 |
| PAY-09 | P1 | D-12 | V-08, V-09 + new |
| PAY-10 | P1 | D-06 | — (route-level test) |
| PAY-11 | P1 | D-05 | — (route-level test) |
| PAY-12 | P2 | D-11 | U-05 |
| PAY-13 | P2 | D-03 | C-13 |
| PAY-14 | P2 | D-13 | O-16, O-17 |
| PAY-15 | P2 | D-14 | U-01–U-03 |
| PAY-16 | P2 | D-07 | A-04 |
| PAY-17 | P2 | D-15 | O-08, O-09 |

---

*End of AUDIT_PAYMENT_CHECKOUT.md — Batch 2 (Payment & Checkout). No application code was modified in the production of this report.*
