# TokoΦ — Store Affiliate Programme (seller-run)

> **Status:** PRD v1.3 (2026-11-14) — **ported to `main` by AFFILIATE-P2** with the identity model the owner
> changed on 2026-11-14 ([ADR 0022](decisions/0022-affiliate-own-accounts.md)): an affiliate has its **OWN
> account** at `affiliate.tokophi.com` (`apps/affiliate`, email + password), **not** the buyer TokoΦ Account
> ("jangan jadikan satu dengan user belanja"). `F-A15` is **changed** accordingly (§8); `F-A18` stays
> **superseded**. The public storefront form (`F-A2` v1) is **replaced** by applying while signed in.
> v1 (`F-A1`–`F-A10`), `F-A12` and `F-A15` are built; `F-A11` and `F-A13` are built by AFFILIATE-V11 (2026-11-14,
> branch `feat/affiliate-v11`); `F-A14`, `F-A16`, `F-A17` are open.
> History: v1.2 (2026-10-15, owner: "akun affiliate itu buat seperti akun user") made the buyer account the
> affiliate identity on the never-merged `feat/accounts-consolidated` (#424/#431/#455); that is reversed.
> This is the feature PRD — the only one: requirements are `F-A*`, tasks are `specs/docs/TASKS.md`
> `AFFILIATE-P2` and its follow-ups. If code and this file disagree, code wins — fix this file.

> **Payout rule (owner 2026-11-14, ADR 0022):** the **seller pays the affiliate outside TokoΦ** and marks the
> commission paid. The 2026-10-19 direction to deduct commissions from the seller balance (PR #424's proposed
> "affiliate commission paid from seller balance" ADR, numbered 0018 there — 0018 is taken on main) is **not
> ported**; it is recorded as a future option in ADR 0022 §4 and a follow-up task.

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
| Affiliate (own affiliate account, many stores — ADR 0022) | Promote several shops, see every commission in one place | Asks each seller on WhatsApp, trusts each seller's tally | Assumed; owner direction 2026-10-15 |
| Store staff without `affiliates:write` (`staff`, `cs`) | Answer a buyer or affiliate question | Opens `/affiliate` (readable by every store role today) | Observed in code (2026-10-15) |
| Shopper | Buy through a creator's link, or type the creator's code | — (no friction today) | — |

First-use journey: merchant enables the programme (Pengaturan → Affiliate) → affiliate opens
`<store>/affiliate` → "Daftar jadi affiliate" → signs up at `affiliate.tokophi.com` and applies to the store
(`/gabung?toko=<slug>`) → merchant approves in Seller panel → affiliate shares `<store>/?ref=CODE` or `CODE` → shopper
buys → commission `pending` → order `selesai` + hold days → "siap dibayar" → merchant transfers and
clicks "Tandai dibayar".

## 3. Product, audience, market context

Country-specific (Indonesia), Bahasa Indonesia UI, IDR, phone/WhatsApp-first identity (F-K2). TikTok
and Instagram bios often drop query strings, so a **typed code** is a first-class attribution path, not
a fallback. **The affiliate's identity is its OWN affiliate account** (ADR 0022, app `apps/affiliate` at
`affiliate.tokophi.com`, email + password) — separate from the buyer account; one login across every shop.
Each shop keeps its own affiliate row (its own approval, rate, payment and code); the account links the
rows. There is no anonymous storefront form any more.

**Messaging is not available.** No WhatsApp Business API or SMS provider is set up (owner 2026-10-15:
"untuk wa dan sms nanti aja masuk task"). Everything an affiliate needs to hear in v1 goes through the
merchant's own `wa.me` link from the Seller list. Automated notifications (`F-A16`) depend on the
platform messaging-channel task and carry no provider design here.

**Tax is the merchant's.** The merchant pays the affiliate outside TokoΦ, so any withholding on that
payment is the merchant's obligation. Commissions to individual non-employees fall under PPh 21
(PMK 168/2023 — identified through DDTC News' summary, the official text was not checked for this
PRD). TokoΦ therefore never computes or withholds tax; it gives the merchant a record to file from
(`F-A11`).

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
- No platform-wide affiliate programme: a person is an affiliate of many stores through ONE account,
  but every store still approves, rates and pays its own affiliates. No store directory in phase 1 (OD-A6).
- Landing-page funnel (`/lp`, OrderFunnel) attribution is v1.1 (`F-A13`, Task 9.6), not v1.
- No tax computation or withholding, no bukti potong (the merchant's obligation, §3).
- No messaging-provider design here: WhatsApp/SMS is a separate platform task (`F-A16` only consumes it).
- No shared login with the buyer account: the affiliate account is its own identity (ADR 0022). No password reset by email in v1 (no mail provider).

## 7. Core features

| Feature | Priority | User benefit | Requirements |
|---|---|---|---|
| Programme settings | Must | Merchant turns it on and sets the rules | F-A1 |
| Application (signed in, ADR 0022) | Must | Affiliates join without chatting the seller | F-A2 |
| Affiliate management | Must | Merchant approves, rejects, deactivates, adds | F-A3 |
| Attribution at checkout | Must | Every referred order is credited to one affiliate | F-A4, F-A5 |
| Commission calculation | Must | Correct amount, frozen at order time | F-A6 |
| Commission lifecycle | Must | Cancelled/returned orders never pay out | F-A7 |
| Mark paid | Must | Merchant's record of what was paid | F-A8 |
| Per-product rate | Should | Higher/lower margin products | F-A9 |
| Isolation | Must | No store sees another's affiliates | F-A10 |
| Commission export | Should (v1.1) | Merchant's bookkeeping and tax record | F-A11 |
| Personal-data masking | Should (v1.1) | Staff can work the list without seeing bank accounts | F-A12 |
| Landing-funnel attribution | Must (v1.1) | `/lp` sales credit the affiliate too | F-A13 |
| Return-after-paid flag | Should (blocked OD-A1) | Merchant knows a paid commission's order came back | F-A14 |
| Cross-store affiliate account (own account, ADR 0022) | Must (built 2026-11-14, AFFILIATE-P2) | One login: every store's code, link and commissions; apply to a store while signed in; accept a seller's invitation | F-A15 |
| ~~Signed per-store dashboard link~~ | superseded by F-A15 | — | ~~F-A18~~ |
| Affiliate notifications | Could (phase 2, blocked on messaging) | Affiliate hears approval / ready / paid | F-A16 |
| Personal-data erasure | Should (v1.1) | A rejected or departed affiliate's details do not linger | F-A17 |

## 8. Requirements

- **F-A1** (Must, state) While `store_settings.affiliate_enabled` is false, the system shall hide the
  storefront `/affiliate` page (404), refuse applications, and attribute no new order.
  - Acceptance: Given a store with the programme off, When a shopper orders with a valid active code,
    Then no `affiliate_commissions` row is written and `/affiliate` answers 404.
- **F-A2** (Must, event — **CHANGED 2026-11-14, ADR 0022**) When a signed-in affiliate account applies to an
  enabled store (`affiliate.tokophi.com/gabung?toko=<slug>`, linked from `<store>/affiliate`), the system shall
  create ONE `affiliates` row with status `menunggu`, a unique code, the account's own name/phone/email, the
  optional bank details and the "where do you promote" note, bound to the account. 5 attempts per account per
  hour, counted in the database before anything is looked at. A row of that store with the same phone and no
  account is never taken over; the answer does not say why. The anonymous storefront form (v1) and its
  "Nomor ini sudah terdaftar" oracle are **removed**; `<store>/affiliate` explains the programme and links to the
  affiliate app, or says applications are not open while `AFFILIATE_APP_URL` is unset.
  - Acceptance: Given an enabled store and a signed-in account, When it applies, Then one `menunggu` row bound to
    the account exists; a second apply answers "sudah terdaftar"; a store whose programme is off answers
    "tidak sedang dibuka" (`apps/affiliate/src/data/affiliate-data.test.ts`).
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
    `batal`; When another order is set `selesai` with 3 hold days (the default), Then `eligible_at` is 3 days later.
- **F-A8** (Must, event) When the merchant marks a ready commission paid, the system shall set
  `dibayar` + `paid_at`; it shall refuse a commission that is not ready.
  - Acceptance: Given a pending commission with `eligible_at` in the future, When "Tandai dibayar" is
    sent, Then it stays `pending` and the action returns a refusal.
- **F-A9** (Should, optional) Where a product has `affiliate_rate_bps`, the system shall use it
  instead of the store default for that product's lines; `0` means no commission on that product and
  any rate is clamped to 0–100 %.
- **F-A10** (Must, ubiquitous) `affiliates` and `affiliate_commissions` shall carry `store_id` with RLS
  `tenant_isolation`, and every Seller-panel read/write shall run through `withTenant`.
  - Acceptance: `verify-rls` passes; under store A's tenant context a select of store B's affiliate
    returns 0 rows.

- **F-A11** (Should, event) When a user with `affiliates:write` exports commissions for a date range,
  the system shall return a CSV of that store's commissions (order number, affiliate name + code,
  source, base, rate, commission, state, `paid_at`, `paid_note`) and nothing from another store.
  - Acceptance: Given store A with 3 commissions and store B with 1, When A's owner exports, Then the
    file has 3 data rows and every row is A's; a `staff` user gets no export.
  - **Built 2026-11-14 (AFFILIATE-V11):** `exportAffiliateCommissionsCsv` (lib/actions/affiliates.ts) + pure
    `lib/affiliate-commission-csv.ts`; proven by `affiliates.test.ts` (3 vs 1 rows) and
    `affiliates-capability.test.ts` (staff / cs / gudang refused before any read).
- **F-A12** (Should, state) While the signed-in user lacks `affiliates:write`, the Seller panel shall
  show an affiliate's bank account and phone masked to the last 4 digits, the email as `x•••@domain`,
  and no `wa.me` link. Masking happens in the data layer (`apps/admin/lib/affiliate-mask.ts`, called
  by `getAffiliateProgram`), so the full value never reaches the RSC payload. Built 2026-10-15
  (gap found the same day: every store role could read `/affiliate` in full).
  - Acceptance: Given a `staff` session, When `/affiliate` renders, Then no full bank account or phone
    number appears in the HTML.
- **F-A13** (Must, event) When an order is placed through a store landing page (`/lp`, OrderFunnel),
  the system shall send the typed code / captured ref exactly as checkout does, so F-A4–F-A6 apply
  unchanged.
  - Acceptance: Given `/lp/<slug>?ref=CODE` opened on an enabled store with `CODE` active, When the
    funnel order is placed, Then one commission row with `source='link'` exists for that order.
  - **Built 2026-11-14 (AFFILIATE-V11), ref only:** `components/OrderFunnel.astro` sends `refCode`; no typed-code
    field in the funnel. Proven by `order-forms-affiliate-ref.test.ts`, the funnel-shaped case in
    `api/public/order/route.test.ts`, and a browser `/lp/<slug>?ref=CODE` order.
- **F-A14** (Should, unwanted) If an order whose commission is `dibayar` moves to `retur`, then the
  system shall keep the commission `dibayar` and mark it "retur setelah dibayar" for the merchant.
  **Blocked on OD-A1** (claw-back policy); v1 leaves the paid row untouched, pinned by
  `affiliate-attribution.test.ts`.
  - Acceptance: Given a `dibayar` commission, When its order is set `retur`, Then the row stays
    `dibayar` and the Seller list shows the flag.
- **F-A15** (Must — **CHANGED 2026-11-14 by ADR 0022**; built by AFFILIATE-P2). An affiliate has its OWN
  account at `affiliate.tokophi.com` (`apps/affiliate`; tables `affiliate_accounts` + `affiliate_sessions`,
  migration `0125`; email + scrypt password; opaque session token, sha256 stored; no Google, no link to
  `buyer_accounts`). One account is an affiliate of many stores, each store keeping its own `affiliates` row
  (`affiliates.account_id`, unique per `(store_id, account_id)`):
  - **Sign-up / sign-in / sign-out / change password** (`/daftar`, `/masuk`, `/keluar`, `/akun`): per-IP cap in
    the fail-closed `login:`/`signup:` buckets, a per-account failure streak (`LoginSurface` `affiliate`), one
    `platform_activity` row per burst; a password change revokes every other session. No reset by email —
    the UI points to the seller / support.
  - **Apply while signed in** (`/gabung?toko=<slug>`, linked from `<store>/affiliate`): one `menunggu` row with
    the ACCOUNT's name and WhatsApp, for a store whose programme is on and which is not suspended; the merchant
    approves it as any other. 5 attempts per account per hour (counted in `rate_limit_counters`). A row in that
    store with the same phone and no account is **not** taken over; the answer is one non-specific message
    ("belum bisa diproses … minta seller mengirim link undangan") that does not say whether the phone exists.
  - **Seller invitation** (`affiliates:write` only, Seller `/affiliate` → "Undang ke akun affiliate"): for an
    `aktif` row with no account, mints a 7-day single-use link `https://affiliate.tokophi.com/undangan?t=…`
    (`@tokophi/lib/affiliate-invite`, only the sha256 stored in `affiliates.invite_hash`); the signed-in
    account sees a confirmation naming the store, and ONE conditional UPDATE binds it and clears the hash.
    **Never bound by email or phone match.**
  - **Affiliate area** (`/`, `/komisi`, `/toko/<id>`): every store of the account with status, code, share link
    `<store>/?ref=CODE`, totals ditahan / siap / dibayar, and per-store commission history (order number and
    money only — no buyer data). Another account's row id answers exactly like an unknown id (404).
  - **Dormant switch:** `AFFILIATE_APP_URL` unset ⇒ every page answers 503 "belum dibuka", `/healthz` 200.
  - Tests: `apps/affiliate/src/data/affiliate-data.test.ts`, `apps/affiliate/src/lib/availability.test.ts`,
    `apps/admin/lib/affiliate-invite.test.ts`, `test/compose-affiliate.test.ts`.
- **F-A16** (Could, event) When an affiliate is approved, a commission becomes ready, or a commission
  is marked paid, the system shall notify the affiliate through the platform messaging channel.
  **Phase 2, blocked on the messaging-channel task** (WhatsApp/SMS not set up). Until then the
  merchant's `wa.me` link is the channel.
  - Acceptance: Given the messaging channel is live, When an affiliate is approved, Then one message is
    queued to the affiliate's phone and the approval succeeds even if sending fails.
- **F-A17** (Should, event) When a user with `affiliates:write` erases a `ditolak` or `nonaktif`
  affiliate, the system shall clear its phone, email and bank fields and replace the name with
  "Affiliate dihapus", keeping the code and every commission row (the merchant's financial record).
  - Acceptance: Given a `nonaktif` affiliate with 2 commissions, When the owner erases it, Then its
    personal fields are null, both commissions still exist, and an `aktif` affiliate cannot be erased.
- **F-A18** — **SUPERSEDED 2026-10-15 by F-A15** (owner: an affiliate account like a user account,
  across many stores — "bukan personal"). The interim signed per-store link (`/affiliate/saya?t=…`,
  `@tokophi/lib/affiliate-link`, `AFFILIATE_LINK_SECRET`) was built and browser-checked the same day,
  then removed on `feat/accounts` before any merge: a bearer link per store is exactly the "personal"
  shape the owner rejected, and two self-views would be two rules.

## 9. Data (migration `0125_affiliate_programme`, AFFILIATE-P2)

| Table.field | Type | Notes |
|---|---|---|
| `store_settings.affiliate_enabled` | boolean, default false | F-A1 — the seller's own switch (Pengaturan → Affiliate) |
| `store_settings.affiliate_rate_bps` | integer, default 1000 (= 10 %), CHECK 0–10000 | store default rate, basis points |
| `store_settings.affiliate_hold_days` | integer, default 3, CHECK 0–90 | return window after delivery before payable (H+3, owner 2026-10-15) |
| `products.affiliate_rate_bps` | integer, null, CHECK 0–10000 | null = store default; 0 = no commission (F-A9) |
| `affiliate_accounts` | id, email (unique, lower-case CHECK), name, phone, password_hash, created_at, disabled_at | ADR 0022 — no `store_id`, RLS on with NO policy (tokophi_app sees nothing) |
| `affiliate_sessions` | id, token_hash (unique sha256), account_id, created_at, expires_at, last_seen_at, revoked_at, user_agent | same |
| `affiliates` | id, store_id, account_id (→ `affiliate_accounts`), code, name, phone, email, bank_*, status `affiliate_status`, note, invite_hash (partial unique), invite_expires_at, created_at, approved_at — UNIQUE `(store_id, code)`, `(store_id, phone)`, `(store_id, account_id)`, `(id, store_id)` | RLS `tenant_isolation` |
| `affiliate_commissions` | id, store_id, affiliate_id, order_id (unique), source CHECK (`link`/`kode`), base_idr, commission_idr (CHECK both ≥ 0), rate_note, status `affiliate_commission_status`, eligible_at, paid_at, paid_note, created_at — FK `(affiliate_id, store_id)` → `affiliates (id, store_id)` | RLS `tenant_isolation` |

`apps/affiliate` runs on the owner connection; every read there carries `account_id = <signed-in account>`.

"Siap dibayar" is derived (`status='pending' and eligible_at <= now()`), not stored: no cron needed.
The `?ref=` capture is `localStorage["tphi:ref"] = {v, t}` on the store's own origin (MarketingPixels
inline script); checkout sends it as `refCode` only while `t` is under 30 days old. The order route
treats `affiliateCode` / `refCode` as **selectors**, resolved against the store's `aktif` affiliates
inside the order transaction (`apps/admin/lib/affiliate-attribution.ts`). `F-A11`–`F-A17` need no new
table; `F-A14` may need one boolean column (decided with OD-A1), `F-A15` a link table owned by the
account spec.

**Retention.** Affiliate personal data (phone, email, bank) lives until the merchant erases it
(`F-A17`); commission rows are the merchant's financial record and are never deleted by the app.

## 10. Owner decisions (answered 2026-10-15) and open questions

Owner answers, 2026-10-15: OD-A3 **yes** (identity reversed 2026-11-14 — ADR 0022); OD-A2 commission becomes payable **3 days after the goods
are delivered** (`selesai` + 3 — "H+3"), default **10 %**, both seller-configurable; OD-A4 left to us
→ the recommended default; OD-A5 **manual only**; OD-A1 not changed → the recommended default stands.
For the seller's own money the owner restated "dana bisa ditarik H+2 setelah barang dikirim" — that is
the platform ledger (`platform_payout.release_on`, `FINANCE.md`), not this spec; it is recorded for the
finance owner and changes nothing here.

| ID | Question | Recommended default | Owner | Blocks |
|---|---|---|---|---|
| OD-A1 | A `retur` after `dibayar`: flag only, or record a claw-back the merchant deducts from the next payment? | **Decided (default stands): flag only** (`F-A14`); TokoΦ never moves the money, so it cannot claw it back. Paying only at delivery + 3 days already shrinks the window. | Owner | Task 9.10 |
| OD-A5 | Owner direction 2026-10-19: pay affiliates from the seller's balance after true delivery. | **Superseded 2026-11-14 (ADR 0022): the seller pays outside TokoΦ.** Balance deduction stays a future option (follow-up task) | Owner | — |
| OD-A2 | Defaults: rate and hold days (0–90 allowed). | **Decided 2026-10-15: 10 %, 3 days after delivery (H+3)**, seller can change both (store default + per-product rate) | Owner | — |
| OD-A3 | May an affiliate sign in with the TokoΦ buyer account to see commissions? | **Decided 2026-10-15: yes — REVERSED 2026-11-14 (ADR 0022): no; affiliates have their own account at affiliate.tokophi.com** | Owner | — |
| OD-A4 | Tax: export only (`F-A11`), or also a tax note on the export? | **Decided 2026-10-15 (owner delegated): CSV export + a one-line note that withholding is the merchant's duty.** The PPh 21 reference in §3 stays marked as a secondary source. | Owner | — |
| OD-A5 | Erasure (`F-A17`): manual only, or automatic after N days for `ditolak`? | **Decided 2026-10-15: manual only** | Owner | — |
| OD-A6 | Should affiliates be able to **discover** stores with an open programme (a directory in the account app)? | **Open.** Default: **no directory in phase 1** — an affiliate joins a store by its address or from that store's `/affiliate` page. A directory exposes which merchants run programmes and invites spam applications. | Owner | — |
| OD-A7 | Cross-store affiliate identity | **Decided 2026-11-14 (ADR 0022): one OWN affiliate account (email + password), many stores**; binding an existing row only by seller invitation | Owner | — |

## 11. Risks and abuse

| Risk | Where it bites | Handling (built / planned) |
|---|---|---|
| Self-referral | Affiliate buys with own code to earn a "discount" | Phone match voids it (`F-A5`, built). A different phone (family) passes — the merchant's approval and the hold window are the remaining controls. |
| Cookie stuffing / ref overwrite | Anyone can open `?ref=` to take last-click credit | Only approved `aktif` affiliates of that store attribute; typed code wins over the ref; the 30-day window is client-side only (accepted: the ref is a selector, not a credential). |
| Refund abuse | Commission paid, then the order is returned | Payable only after `selesai` + hold days (`F-A7`, built); paid-then-returned is flagged (`F-A14`, OD-A1). |
| Application spam | Bots fill `/affiliate` | Honeypot + 5/hour/IP (built); limiter is in-process (NF-6). Programme off by default. |
| Personal data exposure | Bank accounts and phones visible to every store role | Masking (`F-A12`) **built 2026-10-15**; erasure (`F-A17`) planned. |
| Money correctness | Rounding, discounts, overrides | Integer basis points, one floor at the end, frozen at order time (`F-A6`, unit + DB tests). |

## 12. Technical decisions (ADR-lite)

- **Decision:** the merchant pays affiliates outside TokoΦ. **Why:** TokoΦ already holds merchant money
  as a custodian (PRD §1); adding third-party payouts would widen that liability. **Consequence:** no
  `ledger_entries`/`payouts` rows for commissions; "Tandai dibayar" is a record, not a transfer.
- **Decision:** "siap dibayar" is derived from `eligible_at`, not stored. **Why:** no cron, no stale
  state. **Consequence:** every reader uses the same predicate (`markCommissionPaid`, `getAffiliateProgram`).
- **Decision:** commission frozen in the order transaction. **Why:** a later rate change must not
  rewrite history. **Consequence:** rate changes apply to new orders only.
- **Decision (2026-11-14, ADR 0022):** the affiliate has its OWN account at `affiliate.tokophi.com`
  (`apps/affiliate`, email + password), not the buyer account. **Why:** owner — "jangan jadikan satu dengan user
  belanja". **Consequence:** migration `0125` adds `affiliate_accounts` + `affiliate_sessions`; `apps/account`
  carries no affiliate page; the storefront form is gone; dormant until `AFFILIATE_APP_URL` is set.
- **Decision (2026-10-15):** an existing row is bound to an account ONLY by a seller-issued, single-use
  invitation. **Why:** a phone or email match would let anyone with a recycled number or a shared
  inbox claim a stranger's commissions. **Consequence:** form-only affiliates stay unlinked until their
  seller invites them.
- **Decision (2026-10-15):** default hold 3 days, counted from `selesai` (delivered). **Why:** owner
  rule "komisi setelah barang terkirim + H+3". **Consequence:** `0125` defaults
  `affiliate_hold_days` to 3; the code fallback and the settings copy say the same.
- **Decision (2026-10-15):** personal-data masking is a data-layer transform keyed on
  `affiliates:write`, not a UI flag. **Why:** hiding it in the client would still ship the digits.

## 13. Milestones and verification status

- [x] **v1 built** (`F-A1`–`F-A10`, Tasks 9.1–9.5): migration `0116` on the unmerged branch (ported to main as `0125`); `affiliate.test.ts` 10/10 and
  `affiliate-attribution.test.ts` 8/8 on a throwaway DB; `verify-rls` 56/57; storefront browser check
  of `/affiliate`, the rate limit, `?ref=` capture and the checkout field (BUILD-LOG 2026-10-15).
  Seller `/affiliate` driven in Chrome 2026-10-15 as owner and staff (Task 9.4). **Not yet driven:**
  a real order POST carrying `refCode`/`affiliateCode`.
- [ ] **v1.1:** ~~`F-A13` landing funnel (9.6)~~ built 2026-11-14, ~~`F-A12` masking (9.7)~~ done 2026-10-15, ~~`F-A11`
  export (9.8)~~ built 2026-11-14, `F-A17` erasure (9.9) open, `F-A14` after OD-A1 (9.10) open.
- [x] **AFFILIATE-V11 (2026-11-14):** `F-A13` — OrderFunnel (`/promo`, `/lp`) sends the captured `?ref=` as `refCode`
  (ref-only: the funnel has no typed-code field, like it has no voucher field); a `/lp?ref=` COD order in a browser
  produced one `source='link'` commission. `F-A11` — CSV export in Seller → Affiliate → Komisi (order date WIB, both
  ends inclusive, ≤ 366 days, `affiliates:write`, CSV-injection safe, BOM); the OD-A4 withholding note is on the
  screen, not in the file. Also: the seller can edit an affiliate's details; Super Admin → Affiliate resets an
  account's password (interim for AFFILIATE-PW-RESET) and disables / enables it; storefront `/affiliate` shows the
  default rate and hold days. Evidence: BUILD-LOG 2026-11-14 (AFFILIATE-V11).
- [x] **AFFILIATE-P2 (2026-11-14, ADR 0022):** ported to `main` with the changed identity: migration `0125`, new
  app `apps/affiliate` (affiliate.tokophi.com, dormant), Seller `/affiliate` + Pengaturan switch + sidebar badge +
  commission on every order (#430), storefront `/affiliate` link page, attribution in `/api/public/order`.
  Evidence: BUILD-LOG 2026-11-14 (AFFILIATE-P2). `F-A18` stays superseded.
- [ ] **Phase 2:** `F-A16` notifications (9.12) — blocked on the messaging task (root `TASKS.md` 8.38).
