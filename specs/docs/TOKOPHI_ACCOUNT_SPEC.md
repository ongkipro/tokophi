# TokoΦ Account — buyer account specification (phase 1, accepted)

> **Decision:** [ADR 0016](../decisions/0016-global-buyer-account.md), accepted by the owner 2026-11-14
> (Task 5.8 / `BUYER-ACCOUNT-P1`). This file describes what `apps/account` and its touch points actually do.
> The earlier drafts (533 lines on `feature/buyer-account-local` `8dc12d7`; ~1 000 lines on PR #424) are
> history, not contract: they include phone/OTP, saved addresses, checkout autofill and the store
> affiliate workspace, none of which is in phase 1.
> **Runtime:** merged dark — nothing is visible in production until the enablement list in ADR 0016 is done.

## 1. Surfaces and who owns what

| Surface | What it does for the buyer account | Code |
|---|---|---|
| Public order API (`app.tokophi.com/api/public/order`) | On a SUCCESS answer only, adds `claimToken` (HMAC over the order id, 30 days). No buyer row is written. | `apps/admin/app/api/public/order/route.ts`, `@tokophi/lib/claim-token` |
| Storefront `/checkout/sukses` | Shows **"Simpan ke Akun TokoΦ"** only with `ACCOUNT_APP_URL` set AND a token for THIS order in this tab (`sessionStorage.lastOrderClaim`). | `apps/storefront/src/pages/checkout/sukses.astro`, `src/lib/account-link.ts` |
| Account app (`account.tokophi.com`) | Sign-in, claim, order hub, stores, profile & security, closure. | `apps/account` |
| Seller | Pengaturan → **Layanan Pembeli** (return window, complaint period); Pelanggan → **Akun Pembeli**; "Terdaftar" badge + "Tersimpan di Akun TokoΦ" on a customer's orders. | `apps/admin` |

## 2. Account app routes

| Route | Behaviour |
|---|---|
| `/masuk` | Google sign-in (only production method). `/masuk/dev` = password-less email sign-in, **404 in a production build**. |
| `/auth/google/start`, `/auth/google/callback` | Authorization-code flow with a 128-bit `state` cookie; a verified Google email is required. Redirect URI env: `ACCOUNT_GOOGLE_REDIRECT_URI`. |
| `/klaim?t=` | Signed-in only. Shows the store and order number, a consent box, and what the store will / will not see. Every refusal (tampered, expired, unknown, claimed by someone else) reads the same. |
| `/` (Beranda) | Unpaid prepaid order → pay card; shipped → resi card; recent orders; "beli lagi" from delivered orders (links to the store, no price promise). |
| `/orders` | My claimed orders from ACTIVE links; `q` (number or item), `toko`, `status` filters only narrow. |
| `/orders/[number]`, `/receipt` | Allowlisted projection: store, items, totals, status, courier/resi, the order's delivery snapshot, payment (VA/URL only while it waits), store WhatsApp, return window + complaint period once the goods are on their way. A foreign order = 404. |
| `/stores`, `/stores/[slug]` | Stores I am actively linked to; "Putus" revokes the link (nothing store-owned is written). |
| `/account` | Display name, Google email (read-only), devices (revoke one / all others), theme, **Tutup akun**. |
| `/keluar` | Revokes this session row. |

## 3. Rules (each one is tested)

1. **Guest checkout is unchanged.** The order API never requires, reads or writes an account
   (`route.test.ts` "guest checkout with the account feature ON").
2. **The claim is the only bridge.** Token + sign-in + consent ⇒ one `buyer_order_claims` row (`order_id`
   UNIQUE) + an active `buyer_store_links` row, in one transaction under a lock on the account row.
   Nothing matches by email or phone (`buyer-data.test.ts`).
3. **Buyer reads** carry `buyer_id = <me>` on the claim AND an ACTIVE link of the same buyer and store
   (`apps/account/src/data/orders.ts` `mine()`); payment ordering is the platform's one definition
   (`@tokophi/db/order-payment` `latestPaymentFirst()`).
4. **Seller reads** run as `tokophi_app` under RLS: claims/links of its own store only; `buyer_accounts`
   and `buyer_sessions` return zero rows (`customers-account.test.ts`, one buyer across two stores).
5. **Sessions** are rows; the cookie `tphi_account` carries only the row id, signed with a key derived
   from `AUTH_SECRET` (never accepted by, nor accepting, a Seller/Super Admin token —
   `account-lib.test.ts`). 30 days; revoked / suspended / closed ⇒ signed out on the next request.
6. **Closure** revokes sessions (device strings blanked), deletes claims, revokes links, rewrites the
   identity to `closed:<id>` with email/name cleared; store rows are byte-identical (`account-data.test.ts`).
7. **Store promises** (`store_settings.return_window_days` 2–90 working days, floor PP 80/2019 Pasal 69(1);
   `complaint_resolution_days` 1–60 working days): NULL = the buyer is shown nothing; the Seller's input is
   parsed strictly and refused, never guessed (`@tokophi/lib/return-window`, `complaint-service`).

## 4. Environment

| Variable | App | Meaning |
|---|---|---|
| `ACCOUNT_CLAIM_SECRET` (≥ 32 chars) | admin **and** account (same value) | Signs/verifies claim tokens. **It is THE feature switch** — `buyerAccountEnabled()` (`@tokophi/lib/claim-token`): unset ⇒ no token, AND the Seller surfaces stay dormant (no Pelanggan → Akun Pembeli row, no Pengaturan → Layanan Pembeli, `/pelanggan/akun` 404, the saves refuse, no Terdaftar/Tersimpan badge from an account link). Saved values are never touched by the switch. |
| `ACCOUNT_APP_URL` | storefront | Account origin for the "Simpan" link (`https` only in a production build). Unset ⇒ no offer. |
| `AUTH_SECRET` | account | Root of the account session key (derived, never used raw). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ACCOUNT_GOOGLE_REDIRECT_URI` | account | Google sign-in; unset ⇒ no button. |
| `DATABASE_URL`, `STOREFRONT_BASE_DOMAIN`, `ADMIN_URL` | account | Owner connection; store links; merchant-upload thumbnails. |

## 5. Not in phase 1

Store affiliate programme (phase 2) · saved addresses and checkout autofill (F-K13) · phone/OTP · Super
Admin tooling for buyer accounts · a JSON API (`openapi/account.yaml` records why there is none).
