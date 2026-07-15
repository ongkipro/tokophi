# TokoΦ — STATUS: what is real, what is seeded, what is still fake

> **Refreshed 2026-07-14** against the source tree and the live database
> (`docker exec tokophi-db psql -U tokophi -d tokophi`) — **70 tables, 51 migrations (0000–0050), RLS on 45**.
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
| **Multi-tenant isolation** | 45 tables `relrowsecurity = true`; non-owner role `tokophi_app`; `platform_activity` is the only `store_id` table without a policy, deliberately. No tenant context ⇒ **0 rows** |
| **The ledger** | 642 entries live. Balance **derived** (`Σ amount_idr` by status), book **append-only**, 3 partial unique indexes make double-credit a DB impossibility |
| **Sale credited on collection** | `creditSaleForPayment` fires only when a `payments` row reaches `berhasil`, and credits `amount_idr` — never `total`, which adds the gateway's fee |
| **COD booked at the door** | `collectCodOnDelivery` flips the payment at `selesai`; `batal`/`retur` **fail** the pending payment, so cash never collected is never booked |
| **The release rule is read** | `settleOrderLedger` reads `platform_payout.release_on` (default `selesai`). **Fixed `0776e99`** — it was hardcoded, so the super-admin toggle saved a value and changed nothing |
| **Payout request race closed** | `pg_advisory_xact_lock(hashtext(store_id))` inside the txn. (It was `FOR UPDATE` over an aggregate, which Postgres rejects outright — **every withdrawal threw**) |
| **Payout rejection is exact** | the opposing `adjustment` is computed from `Σ ledger_entries WHERE payout_id = ?`, never from `payouts.amount_idr` — so it cannot over- or under-refund |
| **Order lifecycle → inventory** | `batal` **and** `retur` both restore stock, guarded on the previous status so a repeat click cannot double-restore |
| **Order lifecycle → ledger** | release only at `selesai`; the `retur` claw-back **carries the status of the sale it reverses**, so returning a still-pending sale cannot drive the balance negative |
| **COD five-condition gate** | server-side in `/api/public/order`, **before any row is written**. Province resolved from the KiriminAja district id, never from the typed address. Fail-closed 403 |
| **COD is ON, end to end** | Three switches agree: `platform_cod.enabled` (cap **Rp2.000.000**, **6** allow-listed provinces) · `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1` + SPX Economy `type=3`; every other courier is `codAllowed=false` **even where KiriminAja reports `cod=true`**) · `store_settings.cod_enabled = true` for batik-nusantara (default **false** — the merchant opts in). Seller switch: Pengaturan → Pengiriman → "Bayar di Tempat (COD)", with a green **COD** badge on the two SPX rows in Jasa Kirim. **Driven end-to-end in a real browser** (0 console errors): 10 shipping options, the COD badge on the two SPX ones only; AnterAja → no COD payment option; SPX → "COD (Bayar di Tempat)" appears. The `cod` flag on a rate is the **effective** one (KiriminAja capability × platform per-service allowance × the store's `cod_enabled`), never the raw courier capability |
| **Checkout offers exactly the services the seller picked** | **Fixed `35b88a4`** — `/api/public/ongkir` filtered on `store_settings.couriers` (the COURIER list) while the Jasa Kirim card promises *"Pilih layanan yang ditawarkan ke pembeli saat checkout"* and writes to **`store_shipping_methods`** (per service). So **every service the seller switched OFF was still offered**: 14 rates came back for Batik Nusantara's 11 picks, 4 of them never enabled (Jagopack, Sicepat CARGO, BIGPACK, SAP One Day). Now **(platform-enabled couriers) ∩ (merchant's per-service picks)**, keyed `"<courier>:<service_type>"` → **10**. No rows = the merchant never opened the card → fall back to courier-level, never a checkout with zero shipping options |
| **Money endpoints fail CLOSED** | `/api/public/pay/callback` **and** `/api/cron/billing` both 401 in production when their secret is unset. **The cron was fixed `0776e99`** — it read `if (secret && provided !== secret)`, so no secret meant *no gate*, on a route excluded from auth that bills every store on the platform |
| **Platform operator roles enforced** | `requirePlatformAdmin(min)` ranks `support` 1 < `admin` 2 < `owner` 3. **Fixed `0776e99`** — the role was carried in the JWT and never read |
| **Impersonation is `owner`-only and audited** | `impersonateStore` writes `platform_activity`. **Fixed `571ed17`** — it previously required only "logged in" and left **no trace at all** |
| **Auth** | scrypt + `timingSafeEqual`; jose HS256; **two separate cookies** (`session` / `platform_session`) — a merchant login can never reach the control plane |
| **RBAC** | `requireCapability` is the first statement of every mutating admin action (18 of 24 files — billing.ts joined 2026-07-15). `settings:write` is owner-only ⇒ **only an owner can withdraw money** |
| **Suspension** | a past-due store goes read-only; `support:write` opts out, so it can still tell us why |
| **Storefront multi-tenancy** | `Host` → store, 15 s memo, unknown slug **404s** (never another merchant's shop), `astro build` is DB-free |
| **Courier roster** | 12 rows in `platform_couriers`, synced live from KiriminAja; vanished couriers are disabled, never deleted. `effective = (merchant ?? all) ∩ platform-enabled` |
| **AWB honesty** | `orders.awb` holds only a waybill the courier actually issued. **Fixed `0b3cdda`** — it used to store *our own order id* and print it on parcels under "No. resi": an unscannable barcode on a real package |
| **Order address snapshot** | `orders.ship_*` (migration 0042), on 685/700 rows. A buyer who moves house no longer moves every past order with them |
| **The order detail is real** | line items, ongkir, payment method, courier, resi and street address. **Fixed `2a5ffc4`** — all six were fabricated from `hash(order.id)`, including a back-solved **"Penyesuaian"** line that made the invented items reconcile to the order's real total. A merchant opened an order to pack it and saw products the customer never bought |
| **Pesanan is a seller centre** | 6 tabs, server-side search/filter/paging, product-led rows. **The five status tabs are a strict partition**: `0 + 24 + 23 + 595 + 43 = 685 = count(*)`, verified tab by tab against SQL |
| **Super-admin runs on real numbers** | `store_stats` is **no longer read anywhere** (`571ed17`). GMV/orders/products come from `orders` and `products` |
| **The merchant float is shown as a LIABILITY** | "Uang Merchant yang Kami Pegang" — not as revenue. It is what we owe |
| **Abandoned checkouts are CAPTURED** | `checkout_sessions` (migrations `0044` + `0045`, RLS on). The storefront writes the row **as the shopper types** — there is no "abandon" event to listen for; abandonment is the **absence of an order**. A sweep flips `aktif` → `ditinggal` after 60 min of silence and stamps `abandoned_at`. 994 rows: 792 `ditinggal` · 198 `pulih` · 4 `aktif`. **Driven end-to-end in a real browser** (type into checkout → close the tab → the row lands with the true basket → ages → appears on `/pelanggan/keranjang` with its WA number) |
| **The abandonment + recovery rates are honest** | 30-day window, `aktif` excluded from **both** sides. `abandonRate = ditinggal/(ditinggal+orders)` = **80,0%**; `recoveryRate = rescued/(rescued+ditinggal)` = **11,2%**, where **`rescued = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`**. Migration `0045` exists precisely because a straight-through checkout **also** ends `pulih`: the naive `pulih/(pulih+ditinggal)` renders **19,3%** (190 / 982) and tells a shop it rescued every ordinary sale. Both figures re-derived from SQL and reconciled |
| **Ongkir is real AND origin-driven** | every rate is a live KiriminAja API call, and the origin is the seller's **saved pickup address** (`store_settings.sender_kecamatan_id` — itself a KiriminAja district id, the same currency as the shopper's `destinationId`). It used to be a **city name posted by the shopper's browser** (`resolveArea(body.originCity || "Yogyakarta")`): the seller's real warehouse was ignored *and* an untrusted client string decided a price. `body.originCity` is now ignored; no pickup address → fall back to the store's *registered* city and **admit it** (`originFrom: "store-city"`). Proven by moving the origin: Gubeng/Surabaya → Coblong/Bandung repriced SPX Standard Rp17.000 → **Rp17.700** and SPX Economy Rp12.700 → **Rp10.400**, while an injected `originCity:"Jakarta Pusat"` was ignored. **The storefront agrees with the server 8/8** — every price on `/checkout` compared against the API response in the same run. ⚠️ But `KIRIMINAJA_ENV=sandbox`: real responses, **not production tariffs** (see #10) |
| **Recovery links are signed, not guessable** | HS256 jose token `{sid, st}`, **store-bound**, 7-day expiry (`apps/storefront/src/lib/recovery.ts`) — never the raw session id, which in a URL is a bearer credential for a stranger's name, phone and address the moment the link is forwarded or leaks via `Referer` |
| **WA recovery records what it can OBSERVE** | one click opens `wa.me` with the `wa_templates` body filled server-side, and the screen says **"WA dibuka"** — **not "terkirim"**. wa.me cannot tell us whether the message was sent or read, so we do not display it |
| **Tamu vs Terdaftar is a real column, not a defect** | `customers.registered_at IS NULL` = guest (7 terdaftar / 17 tamu). Buying never requires an account — a registration wall in front of an Indonesian checkout is the most reliable way to lose the sale — so the UI styles **Tamu as neutral** and Terdaftar as the extra |
| **The CRM no longer chases carts that never existed** | **Fixed `9206220`** — "keranjang ditinggal" follow-ups (chase *Dress Midi Motif Bunga*, chase *Gamis Syari Polos*) were being shown for baskets that **existed nowhere in the database**: merchants were being sent after ghosts. The seed now derives its 3 cart follow-ups from **real `checkout_sessions` rows**. Orphan cart follow-ups: **0** |
| **Pelanggan counts its customers** | **Fixed `9206220`** — the stat card claimed **"Total Pelanggan 3.128 · +8,2% bulan ini"**. The store has **24**, and nothing anywhere computed a month-over-month change |
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
| **Keranjang Ditinggal (`/pelanggan/keranjang`)** | every figure is a `count`/`sum` over `checkout_sessions` + `orders`; tabs count with **true SQL totals**, not the loaded slice; the ranking is `has-phone first, then subtotal / (1 + minutesAgo/1440)` — a big cart from three weeks ago is not a better call than a fresh one | **994 seeded sessions** (792 `ditinggal`). The real writer exists and works (`apps/storefront/src/pages/api/checkout-session.ts`) and was proven end-to-end in a browser |
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
| 5 | ✅ **`lib/actions/billing.ts` gated** (2026-07-15) | `createSubscriptionPayment` / `cancelSubscriptionInvoice` now call `requireCapability("settings:write", {allowSuspended:true})` as their first statement (was `getSession()` alone). `allowSuspended` so a suspended store can still pay its way back in |

### 3.2 Shipping & orders

| # | Item | Detail |
|---|---|---|
| 6 | **`orders.courier` is NULL on 699/700 rows** | a regular checkout books no shipment, so the per-courier COD return-rate card — **the number the whole COD policy is betting on** — collapses into a single "Tidak diketahui" bucket |
| 7 | **`orders.awb` is NULL on 700/700** | correct behaviour now (only a real waybill lands there), but no demo data exercises the AWB path |
| 8 | 🔴 **The SPX free-return claim is UNVERIFIED** | it is a *Shopee Seller Center* benefit; we reach SPX through *KiriminAja*, a different contract, whose API has **no return field at all**. **The entire SPX-only COD policy rests on it** |
| 9 | **The courier roster comes from ONE reference route** | KiriminAja has no list-couriers endpoint, so `kaServices()` prices origin `2099` → dest `356` and harvests the services out of the response. **The roster is only as complete as that one lane** |
| 10 | **`KIRIMINAJA_ENV` defaults to `sandbox`** | an unset env **in production** silently talks to the sandbox and books no real parcels. The sandbox also never issues an AWB, so `awbPending` is the normal outcome in dev |
| 11 | ✅ **`platform_couriers.services` legacy plain strings — FIXED** | the seed wrote `["Reguler","Same Day"]` where `getCodPolicy` expects `{type,name,group,cod,codAllowed}` objects; it skips non-objects, so a fresh DB had **zero** COD-allowed services and COD could not be exercised at all. The seed now writes objects with `codAllowed = cod && courier === "spx"` → 2 COD-allowed services. `540af0a` added the rest: `store_settings.cod_enabled = true` + **11** `store_shipping_methods` rows, so a fresh clone can exercise COD end-to-end with no API key and no clicking. Verified on a forced re-seed. |
| 12 | **Parcel weight is hardcoded** | `qty × 500 g` |
| 13 | **The label "Cetak" button is a toast stub** | there is no PDF |

### 3.3 Super-admin

| # | Item | Detail |
|---|---|---|
| 14 | ✅ **`invitePlatformAdmin` escalation CLOSED** (2026-07-15) | now `owner`-gated, `role` whitelisted to support/admin/owner, and audit-logged via `logPlatform` — an `admin` can no longer mint an `owner`. Residual: still seeds a fixed `DEV_PASSWORD` until a mailer exists (row 19) |
| 15 | **`setStoreUserRole` + `resetStoreUserPassword`** | both only `admin`-gated, and together they reproduce the end state of `resetOwnerPassword`, which is `owner`-gated |
| 16 | **The `support` role is unreachable** | **zero** actions accept it — including the ticket actions its own doc comment says the role exists for |
| 17 | **Role checks are action-only** | middleware and page guards check for *a* session, not a role. A lower-privileged operator sees every screen; the buttons throw on click |
| 18 | ✅ **Audit gaps CLOSED** (2026-07-15) | `setInvoiceStatus` (money), `invitePlatformAdmin`, `setStoreUserRole`, `saveGateways`, `saveCodAllowed` (COD risk policy) and `createStore` now all write to `platform_activity` (`logStore`/`logPlatform`). No silent privileged mutation remains in the store-lifecycle/billing/settings actions |
| 19 | **`invitePlatformAdmin` hashes a fixed password** | `tokophi123` |
| 20 | **No login rate limit** (still open). `AUTH_SECRET` insecure fallback ✅ **fixed 2026-07-16** — `@tokophi/lib/secret` fails closed (throws) in production if unset; dev-only fallback | |
| 21 | **`sendPaymentReminder` sends nothing** | |
| 22 | **`createStore` still writes a `store_stats` row** | into the table nothing reads any more |

### 3.4 Storefront

| # | Item | Detail |
|---|---|---|
| 23 | ✅ **`/blog` reads the DB** (2026-07-14) | `src/data/content.ts` `getArticles`/`getArticle` (per-tenant, `status='terbit'` hard-filter → drafts 404). Medium-shaped `/blog/[handle]` + `/halaman/[handle]` exist. The hardcoded 4-article array is gone; the merchant's Blog editor now reaches a shopper |
| 24 | **`/akun` is a dead demo form** | "sistem akun aktif setelah backend terhubung" |
| 25 | ✅ **Per-store WhatsApp + tagline** (2026-07-15) | migration `0049` added `stores.whatsapp`/`tagline` (nullable, **no** platform dummy — `DEFAULT_WHATSAPP` removed). NULL → **no button** (honest). Merchant sets it in admin → Pengaturan → Profil (`StoreProfileCard`, normalises `08…`→`62…`) |
| 26 | ✅ **Custom domain built** (2026-07-15) | migration `0050` `store_domains` + RLS; `slugFromCustomDomain()` resolves an `active` host; `primaryHost`/`primaryOrigin()` drive canonical/og/sitemap; admin UI `DomainCard` (add + TXT-verify real; `active` needs a TLS cert via Cloudflare-for-SaaS = not built, UI says so). Merged + deployed |
| 27 | **`SECTION_DEFAULTS` ships fake testimonials** and a "Gratis Ongkir" marquee onto live storefronts | `page_templates` has **0 rows**, so every store falls back to them |
| 28 | **`astro.config.mjs` has `site: "https://batiknusantara.id"`** | one demo brand baked into a multi-tenant app |

### 3.5 Public API

| # | Item | Detail |
|---|---|---|
| 29 | 🔴 **`/api/public/*` runs on the owner connection, outside RLS** | **the single largest RLS hole, and it is on the most security-sensitive path.** Tenant correctness at checkout rests on application code passing an explicit `store_id`, not on the database |
| 30 | ✅ **`POST /api/public/pay` DELETED** (2026-07-16) | unauthenticated route that took `amount` from the body to create a real VA/QRIS bill, called by nothing (payment is created server-side inside `/api/public/order`). Route + dangling `PUBLIC_PAY_API` removed; `/api/public/pay/callback` untouched |
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

### 3.7 Abandoned-cart capture — what is NOT there yet (`d7fc92f`, `9206220`)

The capture itself is 🟢 (§1). These are its known gaps, stated rather than left to be discovered.

| # | Item | Detail |
|---|---|---|
| 41 | 🔴 **Production has none of this** | both commits sit on `worktree-super-admin-overhaul` and are **not merged to main**, so Coolify has shipped nothing. **The live product still records zero abandoned carts** |
| 42 | **The ageing sweep is OPPORTUNISTIC** | it piggybacks on storefront traffic (at most once a minute per SSR process, on the store being written). **A store with no visitors never ages its own carts.** Acceptable now; on the VPS this is a cron, or the read layer derives `ditinggal` on the fly |
| 43 | **The capture rate limiter is in-process memory** | 60/min/IP, per SSR process — the same known gap as `/api/track` (#32). Multi-instance needs a Cloudflare rule |
| 44 | **`CHECKOUT_RECOVERY_SECRET` falls back to `AUTH_SECRET`** | which works — but it means **rotating the auth secret silently invalidates every outstanding recovery link**. Set it explicitly in production |

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
3. ✅ **`invitePlatformAdmin` escalation CLOSED** (#14, 2026-07-15). `owner`-gated + role whitelisted +
   logged. (Was: an `admin` could mint an `owner`, unlogged.)
4. ✅ **`billing.ts` gated** (#5, 2026-07-15). Both money actions now call `requireCapability`; a
   `gudang` user can no longer raise or void the subscription invoices.
5. **Tests for the ledger, the COD gate and the state machine** (#39). `select sum(…) for update` — which
   Postgres rejects outright, so **every withdrawal threw** — shipped because `tsc` cannot see inside a
   SQL string. The same family, one week later: a `ReferenceError: queueSave is not defined` inside a
   client `<script>` in `checkout.astro` blocked the **entire rate load** — no rates → no COD → **no
   order at all** — while `astro check`, lint and build were **all green**; only opening the page in a
   browser caught it. **Money and checkout paths must be exercised, not typechecked.**
