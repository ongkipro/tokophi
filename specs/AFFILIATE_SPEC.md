# TokoΦ — Store Affiliate Programme (seller-run)

> **Status:** PRD v1.2 (2026-10-15). v1 (`F-A1`–`F-A10`) is **built** on `feat/store-affiliate` and
> verified as recorded in §13; `F-A11`–`F-A18` are new, planned or blocked on an owner decision.
> **v1.2 (owner 2026-10-15: "akun affiliate itu buat seperti akun user -> jadi bisa affiliate banyak
> toko bukan personal"):** the affiliate's identity is the **TokoΦ Account** — one login, affiliate of
> many stores. `F-A15` is promoted to phase 1 and **built** on `feat/accounts`; `F-A18` (signed
> per-store link) is **SUPERSEDED** and its code removed.
> This is the feature PRD — the only one: requirements are `F-A*` (mirrored in
> `specs/docs/REQUIREMENTS.md` §2.10), tasks are root `TASKS.md` Stage 9. If code and this file
> disagree, code wins — fix this file. Revised 2026-10-15 against the branch code (owner: "prd baru
> sekalian affiliate dan user akun kau buat dan sempurnakan, untuk wa dan sms nanti aja masuk task").


> **⚠️ Payout rule under change — owner direction 2026-10-19, NOT yet implemented.** *"dana affiliate bisa
> di cairkan setelah barang benar2 terkirim dan memotong saldo seller."* Everything below that says the
> merchant pays outside TokoΦ, that TokoΦ never moves affiliate money, or that tax is the merchant's
> describes the code **as built on 2026-10-15** and will be superseded by
> [ADR 0018](decisions/0018-affiliate-commission-paid-from-seller-balance.md) once that ADR is accepted
> (its open questions Q1–Q8 are listed there). Until then the built behaviour above is what runs.

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
| Affiliate (TokoΦ Account, many stores) | Promote several shops, see every commission in one place | Asks each seller on WhatsApp, trusts each seller's tally | Assumed; owner direction 2026-10-15 |
| Store staff without `affiliates:write` (`staff`, `cs`) | Answer a buyer or affiliate question | Opens `/affiliate` (readable by every store role today) | Observed in code (2026-10-15) |
| Shopper | Buy through a creator's link, or type the creator's code | — (no friction today) | — |

First-use journey: merchant enables the programme (Pengaturan) → affiliate opens `<store>/affiliate`,
applies → merchant approves in Seller panel → affiliate shares `<store>/?ref=CODE` or `CODE` → shopper
buys → commission `pending` → order `selesai` + hold days → "siap dibayar" → merchant transfers and
clicks "Tandai dibayar".

## 3. Product, audience, market context

Country-specific (Indonesia), Bahasa Indonesia UI, IDR, phone/WhatsApp-first identity (F-K2). TikTok
and Instagram bios often drop query strings, so a **typed code** is a first-class attribution path, not
a fallback. **The affiliate's identity is a TokoΦ Account** ([`docs/TOKOPHI_ACCOUNT_SPEC.md`](docs/TOKOPHI_ACCOUNT_SPEC.md)
§17, app `apps/account`): the same account a buyer uses, one login across every shop. Each shop keeps
its own affiliate row (its own approval, rate, payment and code); the account links the rows. The
storefront form stays for people without an account.

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
- No affiliate-only account: the affiliate area lives in the TokoΦ Account (`F-A15`), never a second login.

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
| Commission export | Should (v1.1) | Merchant's bookkeeping and tax record | F-A11 |
| Personal-data masking | Should (v1.1) | Staff can work the list without seeing bank accounts | F-A12 |
| Landing-funnel attribution | Must (v1.1) | `/lp` sales credit the affiliate too | F-A13 |
| Return-after-paid flag | Should (blocked OD-A1) | Merchant knows a paid commission's order came back | F-A14 |
| Cross-store affiliate account | Must (phase 1, built 2026-10-15) | One login: every store's code, link and commissions; apply to a store while signed in; accept a seller's invitation | F-A15 |
| ~~Signed per-store dashboard link~~ | superseded by F-A15 | — | ~~F-A18~~ |
| Affiliate notifications | Could (phase 2, blocked on messaging) | Affiliate hears approval / ready / paid | F-A16 |
| Personal-data erasure | Should (v1.1) | A rejected or departed affiliate's details do not linger | F-A17 |

## 8. Requirements

- **F-A1** (Must, state) While `store_settings.affiliate_enabled` is false, the system shall hide the
  storefront `/affiliate` page (404), refuse applications, and attribute no new order.
  - Acceptance: Given a store with the programme off, When a shopper orders with a valid active code,
    Then no `affiliate_commissions` row is written and `/affiliate` answers 404.
- **F-A2** (Must, event) When a visitor submits the `/affiliate` form on an enabled store, the system
  shall create an `affiliates` row with status `menunggu` for the Host-resolved store, a unique code,
  and the submitted name/phone/email/bank details (the "where do you promote" answer is kept in
  `note`); it is bot-filtered (honeypot answered as a success) and rate-limited (5/hour/IP,
  in-process — the NF-6 caveat applies). A phone that already applied to this store creates nothing
  ("Nomor ini sudah terdaftar"). The storefront writes on the owner connection with an explicit
  `store_id` predicate (the storefront is outside RLS, SYSTEM_MAP §1).
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
- **F-A14** (Should, unwanted) If an order whose commission is `dibayar` moves to `retur`, then the
  system shall keep the commission `dibayar` and mark it "retur setelah dibayar" for the merchant.
  **Blocked on OD-A1** (claw-back policy); v1 leaves the paid row untouched, pinned by
  `affiliate-attribution.test.ts`.
  - Acceptance: Given a `dibayar` commission, When its order is set `retur`, Then the row stays
    `dibayar` and the Seller list shows the flag.
- **F-A15** (Must, phase 1 — **built 2026-10-15**, owner: "akun affiliate itu buat seperti akun
  user -> jadi bisa affiliate banyak toko bukan personal") The system shall let one TokoΦ Account be
  an affiliate of many stores, each store keeping its own `affiliates` row (`affiliates.account_id`,
  migration `0117`; unique per `(store_id, account_id)`):
  - **Apply while signed in** (`apps/account` `/affiliate/gabung?toko=<slug>`, also linked from the
    store's `/affiliate` page when `ACCOUNT_APP_URL` is set): creates one `menunggu` row bound to the
    account for a store whose programme is on and which is not locked; the merchant approves it as any
    other. 5 applications per account per hour (counted in the database). A row in that store with the
    same phone and no account is **not** taken over (someone's form application) — the visitor is told
    to ask the seller for an invitation.
  - **Seller invitation** (`affiliates:write` only, Seller `/affiliate` → "Undang ke Akun TokoΦ"): for
    an `aktif` row with no account, mints a 7-day single-use link (`@tokophi/lib/account-invite`, only
    the sha256 stored in `affiliates.invite_hash`); the signed-in account sees a confirmation naming
    the store, the affiliate and the code, and ONE conditional UPDATE binds it and clears the hash.
    **Never bound by email or phone match** (account spec ACC-14).
  - **Affiliate area** (`/affiliate`, `/affiliate/<id>`): every store of the account with its status,
    code, share link and totals (ditahan / siap / dibayar), and per store the commission history
    (order number, date, base, commission, state, hold date). No buyer personal data. Another
    account's row id answers exactly like an unknown id (404).
  - Acceptance: Given account A affiliated to stores S1 and S2 and account B to S1, When A opens
    `/affiliate`, Then exactly S1 and S2 with their own totals; B sees only its S1 row and gets 404 on
    A's row; an invitation binds once and is refused on reuse, after expiry, for an already-linked row,
    or for a store the account is already in. Tests: `apps/account/src/data/account-data.test.ts`,
    `apps/admin/lib/affiliate-invite.test.ts`.
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

## 9. Data (migration `0116_store_affiliates`)

| Table.field | Type | Notes |
|---|---|---|
| `store_settings.affiliate_enabled` | boolean, default false | F-A1 |
| `store_settings.affiliate_rate_bps` | integer, default 1000 (= 10 %) | store default rate, basis points |
| `store_settings.affiliate_hold_days` | integer, default 3 | return window after delivery before payable (H+3, owner 2026-10-15) |
| `products.affiliate_rate_bps` | integer, null | null = store default; 0 = no commission (F-A9) |
| `affiliates` | id, store_id, code (unique per store, upper), name, phone, email, bank_name, bank_account, bank_holder, status `affiliate_status` (`menunggu`,`aktif`,`ditolak`,`nonaktif`), note, created_at, approved_at | RLS |
| `affiliate_commissions` | id, store_id, affiliate_id, order_id (unique), source (`link`/`kode`), base_idr, commission_idr, rate_note, status `affiliate_commission_status` (`pending`,`dibayar`,`batal`), eligible_at, paid_at, paid_note, created_at | RLS |

**`0117_tokophi_account`** adds `affiliates.account_id` (→ `buyer_accounts`, nullable, unique with
`store_id`), `affiliates.invite_hash` (sha256 of the seller's invitation, partial unique) and
`affiliates.invite_expires_at` (7 days). Owner connection in `apps/account`; every read there carries
`account_id = <signed-in account>`.

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

Owner answers, 2026-10-15: OD-A3 **yes**; OD-A2 commission becomes payable **3 days after the goods
are delivered** (`selesai` + 3 — "H+3"), default **10 %**, both seller-configurable; OD-A4 left to us
→ the recommended default; OD-A5 **manual only**; OD-A1 not changed → the recommended default stands.
For the seller's own money the owner restated "dana bisa ditarik H+2 setelah barang dikirim" — that is
the platform ledger (`platform_payout.release_on`, `FINANCE.md`), not this spec; it is recorded for the
finance owner and changes nothing here.

| ID | Question | Recommended default | Owner | Blocks |
|---|---|---|---|---|
| OD-A1 | A `retur` after `dibayar`: flag only, or record a claw-back the merchant deducts from the next payment? | **Decided (default stands): flag only** (`F-A14`); TokoΦ never moves the money, so it cannot claw it back. Paying only at delivery + 3 days already shrinks the window. | Owner | Task 9.10 |
| OD-A5 | **Owner direction 2026-10-19:** pay affiliates from the seller's balance after true delivery (replaces "merchant pays outside TokoΦ"). Mechanics Q1–Q8 undecided; tax answer required first. | **Proposed** — [ADR 0018](decisions/0018-affiliate-commission-paid-from-seller-balance.md) | Owner + tax adviser | Any payout code |
| OD-A2 | Defaults: rate and hold days (0–90 allowed). | **Decided 2026-10-15: 10 %, 3 days after delivery (H+3)**, seller can change both (store default + per-product rate) | Owner | — |
| OD-A3 | May an affiliate sign in with the TokoΦ buyer account to see commissions? (Same question as the account spec's OD-3.) | **Decided 2026-10-15: yes** — one identity per person, no second login (`F-A15`); still waits for Stage 10 | Owner | Task 9.11 |
| OD-A4 | Tax: export only (`F-A11`), or also a tax note on the export? | **Decided 2026-10-15 (owner delegated): CSV export + a one-line note that withholding is the merchant's duty.** The PPh 21 reference in §3 stays marked as a secondary source. | Owner | — |
| OD-A5 | Erasure (`F-A17`): manual only, or automatic after N days for `ditolak`? | **Decided 2026-10-15: manual only** | Owner | — |
| OD-A6 | Should affiliates be able to **discover** stores with an open programme (a directory in the account app)? | **Open.** Default: **no directory in phase 1** — an affiliate joins a store by its address or from that store's `/affiliate` page. A directory exposes which merchants run programmes and invites spam applications. | Owner | — |
| OD-A7 | Cross-store affiliate identity (2026-10-15) | **Decided: one TokoΦ Account, many stores** (`F-A15` phase 1); binding an existing row only by seller invitation | Owner | — |

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
- **Decision (2026-10-15):** the affiliate self-view IS the TokoΦ Account, phase 1 — one account,
  many stores; each store keeps its own row. **Why:** owner rule ("bukan personal"); one identity per
  person; the store-level approval and payment stay where the money relationship is. **Consequence:**
  `apps/account` + migration `0117` ship with Stage 9; the per-store signed link (`F-A18`) was removed.
- **Decision (2026-10-15):** an existing row is bound to an account ONLY by a seller-issued, single-use
  invitation. **Why:** a phone or email match would let anyone with a recycled number or a shared
  inbox claim a stranger's commissions. **Consequence:** form-only affiliates stay unlinked until their
  seller invites them.
- **Decision (2026-10-15):** default hold 3 days, counted from `selesai` (delivered). **Why:** owner
  rule "komisi setelah barang terkirim + H+3". **Consequence:** `0116` (unmerged) defaults
  `affiliate_hold_days` to 3; the code fallback and the settings copy say the same.
- **Decision (2026-10-15):** personal-data masking is a data-layer transform keyed on
  `affiliates:write`, not a UI flag. **Why:** hiding it in the client would still ship the digits.

## 13. Milestones and verification status

- [x] **v1 built** (`F-A1`–`F-A10`, Tasks 9.1–9.5): migration `0116`; `affiliate.test.ts` 10/10 and
  `affiliate-attribution.test.ts` 8/8 on a throwaway DB; `verify-rls` 56/57; storefront browser check
  of `/affiliate`, the rate limit, `?ref=` capture and the checkout field (BUILD-LOG 2026-10-15).
  Seller `/affiliate` driven in Chrome 2026-10-15 as owner and staff (Task 9.4). **Not yet driven:**
  a real order POST carrying `refCode`/`affiliateCode`.
- [ ] **v1.1:** `F-A13` landing funnel (9.6), ~~`F-A12` masking (9.7)~~ done 2026-10-15, `F-A11` export (9.8), `F-A17`
  erasure (9.9), `F-A14` after OD-A1 (9.10).
- [x] **Phase 1 account (2026-10-15, `feat/accounts`):** `F-A15` cross-store affiliate account (9.11):
  migration `0117`, `apps/account`, Seller "Undang ke Akun TokoΦ", storefront link; 10 real-Postgres
  cases + cross-app invitation test; driven in Chrome (BUILD-LOG). `F-A18` superseded (9.13).
- [ ] **Phase 2:** `F-A16` notifications (9.12) — blocked on the messaging task (root `TASKS.md` 8.38).
