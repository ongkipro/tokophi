# TokoΦ — Store Affiliate Programme (seller-run)

> **Status:** SPEC (2026-10-11, owner decisions recorded below) — being built on `feat/store-affiliate`.
> This is the feature PRD. Requirements are `F-A*` (mirrored in `specs/docs/REQUIREMENTS.md` §2.10);
> tasks are root `TASKS.md` Stage 9. If code and this file disagree, code wins — fix this file.

## 1. Overview

Each merchant can run its own affiliate programme: people promote the store with a personal link or
code, and earn a commission on the product value of the orders they bring in. Indonesian sellers
already do this by hand (resellers/KOLs in WhatsApp groups, "kode admin" typed by the buyer, a
spreadsheet of who sold what). TokoΦ records the attribution at checkout and keeps the commission
ledger; the merchant still pays the affiliate themselves.

## 2. Users and current workaround

| Role | Job to be done | Current workaround | Evidence status |
|---|---|---|---|
| Merchant (owner/admin) | Grow sales through resellers/KOLs without paying ads up front | Gives each reseller a WhatsApp code; buyers mention it in chat; owner tallies in a sheet | Assumed (owner request 2026-10-11) |
| Affiliate (public, no account) | Sign up to promote a store and be credited for sales | Asks the seller on WhatsApp, trusts the seller's tally | Assumed |
| Shopper | Buy through a creator's link, or type the creator's code | — (no friction today) | — |

First-use journey: merchant enables the programme (Pengaturan) → affiliate opens `<store>/affiliate`,
applies → merchant approves in Seller panel → affiliate shares `<store>/?ref=CODE` or `CODE` → shopper
buys → commission `pending` → order `selesai` + hold days → "siap dibayar" → merchant transfers and
clicks "Tandai dibayar".

## 3. Product, audience, market context

Country-specific (Indonesia), Bahasa Indonesia UI, IDR, phone/WhatsApp-first identity (F-K2). TikTok
and Instagram bios often drop query strings, so a **typed code** is a first-class attribution path, not
a fallback. No affiliate login: affiliates have no account in v1 (the TokoΦ buyer account, Task 5.8, is
the later home for an affiliate self-view).

## 4. Owner decisions (2026-10-11)

1. Affiliates **apply publicly** on the storefront; the merchant approves/rejects; the merchant may also
   add one by hand.
2. Commission = **% of product value after discount** (no shipping, fees or tax); store default %,
   optional per-product override.
3. **The merchant pays the affiliate** outside TokoΦ and marks the commission paid. The platform never
   holds or moves affiliate money (no ledger entry, no payout row).
4. Attribution = **`?ref=CODE` link (30 days, last click wins) and a code typed at checkout**.

## 5. Goals and success measure

- A merchant can run a programme end to end without a spreadsheet: every attributed order has exactly
  one commission row with its amount and state.
- Success measure: within 30 days of release, at least one live store has ≥ 1 approved affiliate and
  ≥ 1 commission reaching `dibayar` (read from production: `select count(*) … where status='dibayar'`).

## 6. Non-goals (v1)

- No affiliate login/dashboard, no email/WhatsApp notifications to affiliates (merchant shares status
  via the `wa.me` link from the list, like F-K9).
- No automatic payout, no deduction from the merchant's balance, no platform fee on commissions.
- No multi-level / tiered commissions, no per-affiliate custom rate, no shopper discount tied to the
  affiliate code (a merchant who wants one creates a normal voucher).
- No cross-store affiliates; an affiliate belongs to one store.
- Landing-page funnel (`/lp`, OrderFunnel) attribution is v1.1 (Task 9.6), not v1.

## 7. Core features

| Feature | Priority | User benefit | Requirements |
|---|---|---|---|
| Programme settings | Must | Merchant turns it on and sets the rules | F-A1 |
| Public application | Must | Affiliates join without chatting the seller | F-A2 |
| Affiliate management | Must | Merchant approves, rejects, deactivates, adds | F-A3 |
| Attribution at checkout | Must | Every referred order is credited to one affiliate | F-A4, F-A5 |
| Commission calculation | Must | Correct amount, frozen at order time | F-A6 |
| Commission lifecycle | Must | Cancelled/returned orders never pay out | F-A7 |
| Mark paid | Must | Merchant's record of what was paid | F-A8 |
| Per-product rate | Should | Higher/lower margin products | F-A9 |
| Isolation | Must | No store sees another's affiliates | F-A10 |

## 8. Requirements

- **F-A1** (Must, state) While `store_settings.affiliate_enabled` is false, the system shall hide the
  storefront `/affiliate` page (404), refuse applications, and attribute no new order.
  - Acceptance: Given a store with the programme off, When a shopper orders with a valid active code,
    Then no `affiliate_commissions` row is written and `/affiliate` answers 404.
- **F-A2** (Must, event) When a visitor submits the `/affiliate` form on an enabled store, the system
  shall create an `affiliates` row with status `menunggu` for the Host-resolved store, a unique code,
  and the submitted name/phone/bank details; it is bot-filtered (honeypot) and rate-limited
  (5/hour/IP). A phone that already applied to this store creates nothing ("sudah terdaftar").
  - Acceptance: Given an enabled store, When a valid form is posted, Then one `menunggu` row exists for
    that store and the page shows "Pendaftaran diterima"; a 6th post within the hour from the same IP
    creates nothing.
- **F-A3** (Must, event) When a user with `affiliates:write` approves, rejects, deactivates or adds an
  affiliate, the system shall update its status (`aktif`/`ditolak`/`nonaktif`) for that store only.
  - Acceptance: Given a `menunggu` affiliate, When the owner approves, Then its status is `aktif` and
    `approved_at` is set; a `staff` user without the capability is refused.
- **F-A4** (Must, event) When an order is placed with an affiliate code (typed, else a `ref` captured
  within 30 days), the system shall attribute it to the store's `aktif` affiliate with that code
  (case-insensitive), the typed code winning over the captured ref when it resolves; a typed code that
  does not resolve falls back to the captured ref.
  - Acceptance: Given ref `AAA` captured and typed `BBB`, both active, When the order is placed, Then
    the commission belongs to `BBB` with `source='kode'`; with typed `NOPE` it belongs to `AAA`
    with `source='link'`.
- **F-A5** (Must, unwanted) If the code is unknown, not `aktif`, or the buyer's phone equals the
  affiliate's phone, then the system shall place the order normally with no commission.
  - Acceptance: Given an affiliate whose phone equals the buyer's, When the buyer orders with that
    code, Then the order exists and no commission row does.
- **F-A6** (Must, ubiquitous) The commission shall be computed once, at order time, inside the order
  transaction, as Σ over lines of `line_total × (goods_proceeds / subtotal) × rate`, where rate is the
  product override or the store default, floored to whole rupiah; the rate snapshot and base are stored.
  - Acceptance: Given subtotal 200 000, goods discount 20 000, lines 100 000 @10 % and 100 000 @20 %,
    Then base = 180 000 and commission = 27 000.
- **F-A7** (Must, event) When the order moves to `batal` or `retur`, the system shall set an unpaid
  commission to `batal`; when it moves to `selesai`, it shall set `eligible_at = now + hold days`
  (store setting, default 7). A `pending` commission is "siap dibayar" once `eligible_at <= now()`.
  - Acceptance: Given a pending commission, When the order is set `retur`, Then the commission is
    `batal`; When another order is set `selesai` with 7 hold days, Then `eligible_at` is 7 days later.
- **F-A8** (Must, event) When the merchant marks a ready commission paid, the system shall set
  `dibayar` + `paid_at`; it shall refuse a commission that is not ready.
  - Acceptance: Given a pending commission with `eligible_at` in the future, When "Tandai dibayar" is
    sent, Then it stays `pending` and the action returns a refusal.
- **F-A9** (Should, optional) Where a product has `affiliate_rate_bps`, the system shall use it
  instead of the store default for that product's lines.
- **F-A10** (Must, ubiquitous) `affiliates` and `affiliate_commissions` shall carry `store_id` with RLS
  `tenant_isolation`, and every Seller-panel read/write shall run through `withTenant`.
  - Acceptance: `verify-rls` passes; under store A's tenant context a select of store B's affiliate
    returns 0 rows.

## 9. Data (migration `0116_store_affiliates`)

| Table.field | Type | Notes |
|---|---|---|
| `store_settings.affiliate_enabled` | boolean, default false | F-A1 |
| `store_settings.affiliate_rate_bps` | integer, default 1000 (= 10 %) | store default rate, basis points |
| `store_settings.affiliate_hold_days` | integer, default 7 | return window before payable |
| `products.affiliate_rate_bps` | integer, null | null = store default; 0 = no commission (F-A9) |
| `affiliates` | id, store_id, code (unique per store, upper), name, phone, email, bank_name, bank_account, bank_holder, status `affiliate_status` (`menunggu`,`aktif`,`ditolak`,`nonaktif`), note, created_at, approved_at | RLS |
| `affiliate_commissions` | id, store_id, affiliate_id, order_id (unique), source (`link`/`kode`), base_idr, commission_idr, rate_note, status `affiliate_commission_status` (`pending`,`dibayar`,`batal`), eligible_at, paid_at, paid_note, created_at | RLS |

"Siap dibayar" is derived (`status='pending' and eligible_at <= now()`), not stored: no cron needed.

## 10. Open questions

| Question | Owner | Gate |
|---|---|---|
| Should a `retur` after `dibayar` create a claw-back note for the merchant? v1 leaves a paid commission untouched. | Owner | Before Task 9.4 ships |
| Default rate 10 % and 7 hold days acceptable? | Owner | Before release |
