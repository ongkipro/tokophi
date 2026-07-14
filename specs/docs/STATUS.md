# TokoΦ — STATUS: what is real, what is seeded, what is still fake

> **Refreshed 2026-07-14** against the source tree and the live database
> (`docker exec tokophi-db psql -U tokophi -d tokophi`) — **67 tables, 44 migrations, RLS on 43**.
> Not against the older docs in this folder, which have been wrong three times in ways that mattered.
>
> **The rule: verify, or say you did not.** This project has shipped a fee-bearer feature that was never
> implemented, an ad dashboard with no integration behind it, a courier roster that contradicted the
> live API, a Saldo chip showing `sum(payments)` as if all of it were withdrawable, and a ledger that
> nothing ever credited. **Each of those looked exactly like working software.**

| | Meaning |
|---|---|
| 🟢 **REAL** | DB-backed, verified by reading the code **and** running the query |
| 🟡 **SEEDED-BUT-COMPUTED** | The maths is honest; the rows are demo data. Say "demo data", never "fake" |
| 🔴 **FAKE / NOT WIRED** | A number, a screen or a promise with nothing behind it |

---

## 1. 🟢 REAL

| Thing | Evidence |
|---|---|
| **Multi-tenant isolation** | 43 tables `relrowsecurity = true`; non-owner role `tokophi_app`; `platform_activity` is the only `store_id` table without a policy, deliberately. No tenant context ⇒ **0 rows** |
| **The ledger** | 642 entries live. Balance **derived** (`Σ amount_idr` by status), book **append-only**, 3 partial unique indexes make double-credit a DB impossibility |
| **Sale credited on collection** | `creditSaleForPayment` fires only when a `payments` row reaches `berhasil`, and credits `amount_idr` — never `total`, which adds the gateway's fee |
| **COD booked at the door** | `collectCodOnDelivery` flips the payment at `selesai`; `batal`/`retur` **fail** the pending payment, so cash never collected is never booked |
| **The release rule is read** | `settleOrderLedger` reads `platform_payout.release_on` (default `selesai`). **Fixed `0776e99`** — it was hardcoded, so the super-admin toggle saved a value and changed nothing |
| **Payout request race closed** | `pg_advisory_xact_lock(hashtext(store_id))` inside the txn. (It was `FOR UPDATE` over an aggregate, which Postgres rejects outright — **every withdrawal threw**) |
| **Payout rejection is exact** | the opposing `adjustment` is computed from `Σ ledger_entries WHERE payout_id = ?`, never from `payouts.amount_idr` — so it cannot over- or under-refund |
| **Order lifecycle → inventory** | `batal` **and** `retur` both restore stock, guarded on the previous status so a repeat click cannot double-restore |
| **Order lifecycle → ledger** | release only at `selesai`; the `retur` claw-back **carries the status of the sale it reverses**, so returning a still-pending sale cannot drive the balance negative |
| **COD five-condition gate** | server-side in `/api/public/order`, **before any row is written**. Province resolved from the KiriminAja district id, never from the typed address. Fail-closed 403 |
| **Money endpoints fail CLOSED** | `/api/public/pay/callback` **and** `/api/cron/billing` both 401 in production when their secret is unset. **The cron was fixed `0776e99`** — it read `if (secret && provided !== secret)`, so no secret meant *no gate*, on a route excluded from auth that bills every store on the platform |
| **Platform operator roles enforced** | `requirePlatformAdmin(min)` ranks `support` 1 < `admin` 2 < `owner` 3. **Fixed `0776e99`** — the role was carried in the JWT and never read |
| **Impersonation is `owner`-only and audited** | `impersonateStore` writes `platform_activity`. **Fixed `571ed17`** — it previously required only "logged in" and left **no trace at all** |
| **Auth** | scrypt + `timingSafeEqual`; jose HS256; **two separate cookies** (`session` / `platform_session`) — a merchant login can never reach the control plane |
| **RBAC** | `requireCapability` is the first statement of every mutating admin action (17 of 24 files — see §3.1 #5 for the exception that matters). `settings:write` is owner-only ⇒ **only an owner can withdraw money** |
| **Suspension** | a past-due store goes read-only; `support:write` opts out, so it can still tell us why |
| **Storefront multi-tenancy** | `Host` → store, 15 s memo, unknown slug **404s** (never another merchant's shop), `astro build` is DB-free |
| **Courier roster** | 12 rows in `platform_couriers`, synced live from KiriminAja; vanished couriers are disabled, never deleted. `effective = (merchant ?? all) ∩ platform-enabled` |
| **AWB honesty** | `orders.awb` holds only a waybill the courier actually issued. **Fixed `0b3cdda`** — it used to store *our own order id* and print it on parcels under "No. resi": an unscannable barcode on a real package |
| **Order address snapshot** | `orders.ship_*` (migration 0042), on 685/700 rows. A buyer who moves house no longer moves every past order with them |
| **The order detail is real** | line items, ongkir, payment method, courier, resi and street address. **Fixed `2a5ffc4`** — all six were fabricated from `hash(order.id)`, including a back-solved **"Penyesuaian"** line that made the invented items reconcile to the order's real total. A merchant opened an order to pack it and saw products the customer never bought |
| **Pesanan is a seller centre** | 6 tabs, server-side search/filter/paging, product-led rows. **The five status tabs are a strict partition**: `0 + 24 + 23 + 595 + 43 = 685 = count(*)`, verified tab by tab against SQL |
| **Super-admin runs on real numbers** | `store_stats` is **no longer read anywhere** (`571ed17`). GMV/orders/products come from `orders` and `products` |
| **The merchant float is shown as a LIABILITY** | "Uang Merchant yang Kami Pegang" — not as revenue. It is what we owe |
| **Analitik / Pelanggan / Pemasaran aggregates** | every figure is a counted row |
| **Public API rate limits** | ongkir 60/min · order 10/min · pay 20/min · callback 60/min · track 30/min (all per IP) |
| **Self-serve signup** | `/daftar` → one-transaction `provision.ts` |
| **SEO hygiene** | both panels `noindex, nofollow` in 3 layers; `/api/uploads/*` carved out so merchant product photos stay in Google Images; landing + storefronts indexable; `www` 301s to the apex |

---

## 2. 🟡 SEEDED-BUT-COMPUTED

Honest arithmetic over demo rows. These are **not** lies — but do not quote them at anyone.

| Thing | The maths | The rows |
|---|---|---|
| **Conversion funnel + device split** | real `GROUP BY` over `analytics_events`, day-bucketed so the range switcher actually changes them, reconciling with the KPIs beside them **by construction** (`visit` == `analytics_daily.visitors`, `purchase` == `.orders`) | **47.804 rows, still overwhelmingly seeded.** The real writer exists and works (`apps/storefront/src/pages/api/track.ts`) |
| **Dashboard / Analitik series** | `analytics_daily` | 122 rows |
| **Ledger balances** | derived correctly, entry by entry | backfilled by migration `0041` from seeded payments: 595 `sale/available` (Rp209.374.000) + 47 `sale/pending` (Rp18.436.000), **and zero payouts** |
| **Store catalogue** | — | 7 stores · 14 products · 700 orders · 685 payments · 24 customers · 1.767 line items. Anchored `TODAY = 2026-06-30` |
| **Super-admin health verdicts** | `100 − fails×40 − warns×15` | hardcoded thresholds |

---

## 3. 🔴 FAKE / NOT WIRED

### 3.1 Money & policy

| # | Item | Detail |
|---|---|---|
| 1 | **`platform_cod.fee_pct`** | **2 grep hits in the entire repo**: the schema definition and the seed. **There is no COD fee.** It is the obvious lever for widening COD beyond one courier, and it is not built |
| 2 | **`platform_payout.auto_approve`** | read into the type, never written, never displayed |
| 3 | **`max_amount_idr` / `allowed_provinces` have no super-admin UI** | they **are enforced** (from the seed), but there is no screen to edit them — while the `/pengaturan` copy claims "limit & area diatur di sini" |
| 4 | **`packages/lib/src/payment-fees.ts` has ZERO importers** | the merchant-facing **fee-bearer feature does not exist**. `store_settings.payment_fee_bearer` is a dead column. The tab that wrote it was removed |
| 5 | **`lib/actions/billing.ts` has no capability gate** | `createSubscriptionPayment` / `cancelSubscriptionInvoice` raise and void **real invoices**, gated on `getSession()` alone — so a `gudang` user can create or cancel the store's subscription bill |

### 3.2 Shipping & orders

| # | Item | Detail |
|---|---|---|
| 6 | **`orders.courier` is NULL on 699/700 rows** | a regular checkout books no shipment, so the per-courier COD return-rate card — **the number the whole COD policy is betting on** — collapses into a single "Tidak diketahui" bucket |
| 7 | **`orders.awb` is NULL on 700/700** | correct behaviour now (only a real waybill lands there), but no demo data exercises the AWB path |
| 8 | 🔴 **The SPX free-return claim is UNVERIFIED** | it is a *Shopee Seller Center* benefit; we reach SPX through *KiriminAja*, a different contract, whose API has **no return field at all**. **The entire SPX-only COD policy rests on it** |
| 9 | **The courier roster comes from ONE reference route** | KiriminAja has no list-couriers endpoint, so `kaServices()` prices origin `2099` → dest `356` and harvests the services out of the response. **The roster is only as complete as that one lane** |
| 10 | **`KIRIMINAJA_ENV` defaults to `sandbox`** | an unset env **in production** silently talks to the sandbox and books no real parcels. The sandbox also never issues an AWB, so `awbPending` is the normal outcome in dev |
| 11 | **`platform_couriers.services` holds legacy plain strings in the seed** | `["Reguler","Same Day"]`, not `{type,name,cod,codAllowed}` objects. `getCodPolicy` skips non-objects — so **on a freshly seeded local DB no service is COD-allowed and COD cannot be exercised at all** until someone presses "Sync dari KiriminAja" in super-admin |
| 12 | **Parcel weight is hardcoded** | `qty × 500 g` |
| 13 | **The label "Cetak" button is a toast stub** | there is no PDF |

### 3.3 Super-admin

| # | Item | Detail |
|---|---|---|
| 14 | 🔴 **`invitePlatformAdmin` is a privilege-escalation path** | `admin`-gated, takes `role` **unvalidated**, and is **not audit-logged** — so an `admin` operator can mint themselves an `owner` and thereby reach the two `owner`-only actions (impersonate, reset owner password). **This quietly undoes the role check that landed in `0776e99`** |
| 15 | **`setStoreUserRole` + `resetStoreUserPassword`** | both only `admin`-gated, and together they reproduce the end state of `resetOwnerPassword`, which is `owner`-gated |
| 16 | **The `support` role is unreachable** | **zero** actions accept it — including the ticket actions its own doc comment says the role exists for |
| 17 | **Role checks are action-only** | middleware and page guards check for *a* session, not a role. A lower-privileged operator sees every screen; the buttons throw on click |
| 18 | **Audit gaps** | `setInvoiceStatus` (**money**), `invitePlatformAdmin`, `setStoreUserRole`, `saveGateways`, `saveCodAllowed` (**COD risk policy**) and `createStore` all mutate and write **nothing** to `platform_activity` |
| 19 | **`invitePlatformAdmin` hashes a fixed password** | `tokophi123` |
| 20 | **No login rate limit**, and `AUTH_SECRET` falls back to `"dev-insecure-secret-change-me"` | |
| 21 | **`sendPaymentReminder` sends nothing** | |
| 22 | **`createStore` still writes a `store_stats` row** | into the table nothing reads any more |

### 3.4 Storefront

| # | Item | Detail |
|---|---|---|
| 23 | 🔴 **`/blog` is four hardcoded articles** | `const articles: Article[] = [ … ]` in the page source. The `blogs` / `articles` tables are **never read** and there is no detail route. **The merchant's blog editor publishes into a void** |
| 24 | **`/akun` is a dead demo form** | "sistem akun aktif setelah backend terhubung" |
| 25 | **Every store shares one WhatsApp number** | `DEFAULT_WHATSAPP = "6281234567890"` (`src/data/store.ts`), and there is **no per-store column** to override it |
| 26 | **Custom domains are a `return null` stub** | there is no `stores.custom_domain`; the `domains` table exists and is empty |
| 27 | **`SECTION_DEFAULTS` ships fake testimonials** and a "Gratis Ongkir" marquee onto live storefronts | `page_templates` has **0 rows**, so every store falls back to them |
| 28 | **`astro.config.mjs` has `site: "https://batiknusantara.id"`** | one demo brand baked into a multi-tenant app |

### 3.5 Public API

| # | Item | Detail |
|---|---|---|
| 29 | 🔴 **`/api/public/*` runs on the owner connection, outside RLS** | **the single largest RLS hole, and it is on the most security-sensitive path.** Tenant correctness at checkout rests on application code passing an explicit `store_id`, not on the database |
| 30 | **`POST /api/public/pay` is dead but live** | no storefront file reads `PUBLIC_PAY_API`, yet the route still accepts unauthenticated requests to create real gateway bills |
| 31 | **`/api/track` guards are per-process in-memory** | they do not hold across replicas. No proof-of-work, no signature, no session check — a distributed script with a browser UA can still inflate the funnel |
| 32 | **Every rate limit is in-process** | none survives a restart. The production answer is the Cloudflare edge |
| 33 | **`ADMIN_BASE` is derived from `PUBLIC_ONGKIR_API`'s origin** | a load-bearing coupling with no test: change the ongkir URL and every product image silently moves |

### 3.6 Data quality & process

| # | Item | Detail |
|---|---|---|
| 34 | **There is no Meta / Google / TikTok integration** | `ad_channels` / `ad_metrics` exist; the only OAuth in the repo is Google *Sign-In*. `/pemasaran` now correctly says "Belum terhubung" — spend, impressions, ROAS and campaign lists were pure fabrication and were deleted |
| 35 | **`orders.province` is buyer-typed** (and NULL on 15/700) | never gate money on it — and we do not |
| 36 | **The seed has no `retur` orders and no `cod` payments** | so the **two most expensive code paths in the product have no demo data** and cannot be exercised by clicking around |
| 37 | **`payouts` is 0 rows** | the payout and adjustment paths likewise have no demo data |
| 38 | **`apps/admin/lib/mock/store.ts` still exists**, with 6 `mulberry32` generators | imported by ~10 client components — almost entirely for its **TypeScript types**, plus the constants `TODAY` / `PRODUCTS` / `BLOG_CATEGORIES`. A loaded gun on the shelf: one careless import from putting invented data back on a screen |
| 39 | 🔴 **One test file in the entire repo** | `packages/lib/src/integration-status.test.ts`. **Nothing automatically tests the ledger, the COD gate, or the order state machine** |
| 40 | **`stores.plan` / `plans` / `plan_key` are legacy** | the product has **one** plan; the enum still defaults to `'pemula'` |

---

## 4. Things I could NOT verify

Stated as unverified rather than guessed.

1. **The SPX free-return claim** (§3.2 #8). Needs KiriminAja, in writing.
2. **Whether AutoLaris and KiriminAja behave in production as in sandbox.** `KIRIMINAJA_ENV` defaults to
   sandbox and the sandbox never issues an AWB, so the real booking path has never been observed.
3. **The AutoLaris callback signature spec.** We compare a shared secret; whether that is what AutoLaris
   actually sends in production is not confirmed against their documentation.
4. **Google OAuth against real credentials.** The code path has never been run.
5. **RLS under `tokophi_app` in production.** Proven locally, and once on production data for migration
   0036; not re-proven since.
6. **Whether the production database matches this local one.** Every count here is local.
7. **Chat (migration 0043).** The schema is in the database; the application code was **uncommitted and
   in flight** while this was written. Not exercised.

---

## 5. If you fix five things, fix these

Ordered by what is currently **lying, leaking, or unmeasurable** — not by effort.

1. **`orders.courier` is NULL on 699/700** (#6). The COD policy is a bet, and this is the instrument
   that would tell us whether we are winning it. We cannot currently measure the thing we optimised for.
2. **The SPX free-return claim** (#8). One email. If it is false, the COD narrowing is pointless and we
   are leaving money on the table for nothing.
3. **`invitePlatformAdmin` privilege escalation** (#14). An `admin` can mint an `owner`, unlogged — which
   undoes the role check that just landed.
4. **`billing.ts` has no capability gate** (#5). Any logged-in user of a store can raise or void its
   subscription invoices.
5. **Tests for the ledger, the COD gate and the state machine** (#39). `select sum(…) for update` — which
   Postgres rejects outright, so **every withdrawal threw** — shipped because `tsc` cannot see inside a
   SQL string. **Money paths must be exercised, not typechecked.**
