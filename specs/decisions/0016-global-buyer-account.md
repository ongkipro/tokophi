# ADR 0016 — Global TokoΦ buyer identity with isolated per-store customer projections

**Status:** accepted · **Date:** 2026-11-14 · **Decided by:** the owner ("buyer akun dulu, affiliate menyusul"
— phase 1 = buyer account; the store affiliate programme is phase 2 and is NOT part of this decision)
**Task:** 5.8 (root `TASKS.md`) / `BUYER-ACCOUNT-P1`
**Built from:** the 123-line draft on `feature/buyer-account-local` (`8dc12d7`, 2026-08-11), adjusted below
to what phase 1 actually ships (PR "BUYER-ACCOUNT-P1"; the buyer half of the unmerged PR #424).
**Related:** ADR 0003 (shared multi-tenancy), ADR 0009 (SSR multi-tenant storefront), ADR 0004 (no provider
text to clients), `specs/docs/TOKOPHI_ACCOUNT_SPEC.md`, `specs/docs/SECURITY.md` §1/§2/§4.

## Context

A buyer may purchase from several independent merchants running on TokoΦ. A separate account per store
would repeat sign-in and order-history navigation while producing little value beyond guest checkout.

The existing `customers` table is store-scoped commerce/CRM data. It must not become a global customer
directory, and a merchant must never learn the buyer's relationship with another store. Indonesian
checkout never asks for registration, and it must not start to: a signup wall in front of the payment
step loses the sale (AGENTS.md "Buying never requires an account").

## Decision

### 1. One global buyer subject, on one platform origin

TokoΦ owns ONE buyer identity per person (`buyer_accounts`, migration 0121), served by its own app
`apps/account` on the platform origin `https://account.tokophi.com` — not a tenant storefront, not a
custom domain, not the Seller panel. The identity is cross-tenant platform data and carries no `store_id`.

**Phase 1 sign-in is Google only** (the Seller panel's Google client, its own redirect URI
`ACCOUNT_GOOGLE_REDIRECT_URI`), with a password-less email sign-in that exists only in a non-production
build. No password is ever minted or stored for a buyer. *(Draft said phone verification; phone/OTP needs
a messaging provider and is deferred — see "Deferred".)*

### 2. Store customer rows stay separate; the claim is the only bridge

Each merchant keeps its own `customers` row under `store_id`; rows are never merged across stores. The
ONLY bridge from an account to a store's orders is an explicit **claim** (migration 0122):

```text
buyer_accounts ──(consent per store)── buyer_store_links (store_id, active|revoked)
                └─(one claimant/order)─ buyer_order_claims (store_id, order_id UNIQUE) ── orders ── customers
```

Nothing is ever matched by email or phone — a matching phone alone is refused as proof (recycled and
shared numbers).

### 3. How a claim happens (replaces the draft's PKCE handoff for phase 1)

1. `/api/public/order` returns a **claim token** on its success answer only: `HMAC-SHA256` over
   `order_id.issued_at` under `ACCOUNT_CLAIM_SECRET` (≥ 32 chars), valid 30 days (`@tokophi/lib/claim-token`).
   It grants a claim ATTEMPT on that one order, nothing else. Unset secret ⇒ no token, feature off.
2. The storefront success page keeps it in `sessionStorage` (this tab only — never the `lastOrder`
   localStorage a shared device would keep) and, when `ACCOUNT_APP_URL` is set, offers
   **"Simpan ke Akun TokoΦ"** → `https://account.tokophi.com/klaim?t=<token>`.
3. The buyer signs in on the account origin and ticks a consent box that names the store and says what
   the store will and will not see. Then one transaction writes the claim (`order_id` UNIQUE = one
   claimant, ever; `store_id` copied from the ORDER row) and creates/re-activates the store link with
   the consent version.

No session, cookie or token is handed to the storefront: the storefront never knows who the buyer is.
That is why the draft's authorization-code/PKCE handoff is not needed in phase 1 — it becomes necessary
only with checkout autofill (deferred).

### 4. Buyer and merchant projections differ

- **Buyer** (apps/account, owner connection, every statement keyed `buyer_id = <me>` AND joined to an
  ACTIVE link of the same buyer and store): their claimed orders across linked stores through an explicit
  allowlist — store, number, items, totals, status, courier/resi, the order's own delivery snapshot, the
  live payment instruction while it waits, the store's WhatsApp, and the store's declared return window
  and complaint-resolution period (migrations 0123/0124; NULL = the buyer is shown nothing). Never notes,
  tags, fees, ledger, provider ids, or another customer.
- **Merchant** (Seller panel, `tokophi_app` under RLS): only that a customer of THIS store is connected,
  since when, and which of THIS store's orders were saved (Pelanggan → **Akun Pembeli**, the "Terdaftar"
  badge, "Tersimpan di Akun TokoΦ" on the customer's orders). Never the account's email, name, devices,
  other stores, or aggregate spend.

**How tenant isolation holds:** `buyer_store_links` and `buyer_order_claims` carry `store_id` and the
standard `tenant_isolation` policy, so a Seller sees only its own rows and cannot write into another
store (WITH CHECK). `buyer_accounts` and `buyer_sessions` have **RLS enabled with NO policy** (the 0098 /
0106 shape): every tenant-scoped path sees zero rows, so even a deliberate join from a Seller query to
the account returns nothing. apps/account is the only reader of those two tables, on the owner
connection, with an explicit `buyer_id` predicate on every statement. Proved by
`apps/admin/lib/data/customers-account.test.ts` (one buyer, two stores, under RLS) and
`apps/account/src/data/buyer-data.test.ts` (two buyers, every read and write).

### 5. Guest checkout remains mandatory

An account is optional and offered only AFTER the order exists. Registration or sign-in never blocks,
precedes or changes checkout; the order API writes no buyer row; failure or abandonment of the claim
cannot roll back, duplicate or hide the order. Proved by `route.test.ts` ("guest checkout with the account
feature ON").

### 6. Sessions do not collide with Seller sessions

The account session is a jose JWT in a host-only cookie `tphi_account` on the account origin, carrying
only a `buyer_sessions.id`; the ROW decides on every request (revoked, older than 30 days, or a
non-active account ⇒ signed out). It is signed with a key HMAC-**derived** from `AUTH_SECRET`, requires
audience `tokophi-account`, and is set through `@tokophi/lib/session-cookie`. A Seller/Super Admin token
(raw `AUTH_SECRET`) never verifies as an account session and vice versa
(`apps/account/src/lib/account-lib.test.ts`). Account pages send `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, and refuse
cross-origin POSTs (Astro `checkOrigin`).

### 7. Unlink and two-layer closure

- **Unlink a store:** the link goes `revoked`; the store's orders vanish from the account and the store
  sees a guest again. Nothing store-owned is written.
- **Close the account:** sessions revoked (device strings blanked), claims deleted, links revoked,
  identity rewritten to an inert `closed:<id>` marker with email and name cleared — the same Google
  account later starts a NEW, empty account. Orders, customers, payments and the ledger are never touched.

## Phase 1 scope (shipped by BUYER-ACCOUNT-P1)

1. Google sign-in, server-side sessions, device list, sign out here / everywhere else.
2. Claim an order from the success page (token + consent).
3. Order hub (search, store and status filters), order detail, printable receipt, "beli lagi".
4. Linked stores list, store profile, unlink.
5. Return window + complaint-resolution period: declared by the store in Seller → Pengaturan →
   **Layanan Pembeli**, shown to the buyer on orders that are on their way or delivered; the complaint
   hand-off opens the store's own WhatsApp.
6. Seller: Pelanggan → **Akun Pembeli**, connection badge, saved-order marker.
7. Close account.

## Deferred (not decided as "no" — not in phase 1)

- Store **affiliate** programme and the account's affiliate workspace (phase 2; PR #424's affiliate half,
  #430/#431/#455).
- Saved addresses and contact/address **autofill** at checkout (F-K13) — and with it the PKCE/BFF
  handoff to storefronts and custom domains.
- Phone verification / OTP, phone-based historical claims.
- Super Admin tooling for buyer accounts (suspend, support lookup).

## Explicit non-goals (unchanged from the draft)

Payment-card storage, payment vault, wallet, stored balance or platform credit · required account
creation before checkout · sharing buyer cookies across merchant/custom domains · exposing cross-store
activity or global buyer analytics to merchants · combining carts or checkout across stores · loyalty,
referrals, subscriptions, social graph or advertising audiences · reusing merchant `users`,
`platform_admins`, their cookies, JWT audiences, roles or recovery flows.

## Consequences

**Positive.** One account and order hub across the TokoΦ network; merchants keep ownership of their
customer and commerce data; the payment-wallet risk is avoided.

**Cost and risk.** TokoΦ now links one person's activity across independent merchants (inside the
platform only — no merchant sees it), which raises privacy, account-takeover, deletion and breach
consequences. Central identity becomes a platform service with its own deploy, secrets and Google
redirect URI.

## Production enablement — still owner-gated after merge

Merging ships **no behaviour change in production** — the Seller screens included: `buyerAccountEnabled()` (`ACCOUNT_CLAIM_SECRET` set, ≥ 32 chars, the same predicate that issues claim tokens) is the ONE switch, and while it is off Pelanggan → Akun Pembeli and Pengaturan → Layanan Pembeli are hidden and refuse a typed URL / direct save (owner review 2026-11-14): the claim token needs `ACCOUNT_CLAIM_SECRET` on the
admin app, the offer needs `ACCOUNT_APP_URL` on the storefront, and `apps/account` has no Dockerfile or
compose service yet. Before switching it on: (1) the UU PDP processing note for the storefront privacy page
and `PRIVACY-COMPLIANCE.md` (TokoΦ as controller of the account data); (2) container + DNS for
`account.tokophi.com` (Cloudflare-proxied like every `tokophi.com` record); (3) the account redirect URI
added to the Google client; (4) `ACCOUNT_CLAIM_SECRET` (same value on admin and account) and `AUTH_SECRET`
on the account app; (5) a retention rule for revoked session rows (kept, device string blanked on
closure — no purge job exists).

## Alternatives rejected

- **One independent buyer account per store.** Duplicates sign-in, fragments order history, little value.
- **Make `customers` global.** Destroys merchant ownership and tenant isolation semantics.
- **Shared account cookie across every custom domain.** Cookie scope, browser behaviour and tenant trust
  boundaries make it unsafe and unreliable.
- **Match orders to an account by phone or email.** A number is recycled and shared; possession of the
  order's claim token is the proof.
- **Build the payment vault first.** Adds financial/security scope before identity, consent, recovery and
  order aggregation are proven.
