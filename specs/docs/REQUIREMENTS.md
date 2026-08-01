# TokoΦ — REQUIREMENTS

> **Created 2026-07-14.** Functional and non-functional requirements, written as **verifiable
> statements**. Every requirement has a **Verify** column: a query, a grep, or an action you can
> actually perform. A requirement you cannot check is a wish, not a requirement.
>
> Status legend: **MET** (verified) · **PARTIAL** (holds in part, gap named) · **NOT MET** (tracked in
> [`BACKLOG.md`](./BACKLOG.md)) · **UNVERIFIED** (we do not know, and saying so is the point).
>
> This file exists because the docs in this folder have been wrong in ways that cost money: they
> described a payment fee-bearer feature that was never built, an ad integration that does not exist,
> a courier roster that contradicted the live API, and a ledger that nothing credited. **The invariants
> in §1 are the ones that were learned the hard way.** Treat them as non-negotiable.

---

## 1. Security invariants (learned the hard way — do not regress these)

| ID | Invariant | Why it exists | Verify | Status |
|---|---|---|---|---|
| **SEC-1** | **The tenant boundary is RLS, not a hand-written `WHERE`.** Every admin read and write executes inside `withTenant()` / `withCurrentTenant()`, which sets `app.store_id` and `SET LOCAL ROLE tokophi_app`. A bare module-level `db` in admin tenant code runs as **owner** and silently bypasses every policy. | One forgotten `where store_id = …` and store A reads store B. The database must be the thing that says no. | `grep -rn "withTenant\|withCurrentTenant" apps/admin/lib/data apps/admin/lib/actions` — every file must appear. `npm run verify-rls -w @tokophi/db` | **MET** — 45 tables `relrowsecurity=true` (incl. `checkout_sessions`, `store_domains`) |
| **SEC-2** | **No tenant context ⇒ zero rows.** An unset `app.store_id` GUC makes `app_current_store_id()` return NULL, and `store_id = NULL` is never true. It fails **closed**, never open. | The alternative — defaulting to "show everything" — is a cross-tenant leak with no error message. | `SET ROLE tokophi_app; SELECT count(*) FROM orders;` → **0** | **MET** |
| **SEC-3** | **Money endpoints fail CLOSED.** A missing secret means *no entry*, never *no gate*. Applies to `/api/public/pay/callback` (`AUTOLARIS_CALLBACK_SECRET`) and `/api/cron/billing` (`CRON_SECRET`): both **401 in production when the secret is unset**. | Both were once `if (secret && provided !== secret)` — with the env var absent there was no check at all, on endpoints that mark orders paid and bill every store on the platform. A guard that reads as if it works is worse than no guard. | `grep -n "NODE_ENV === \"production\"" apps/admin/app/api/public/pay/callback/route.ts apps/admin/app/api/cron/billing/route.ts` | **MET** |
| **SEC-4** | **The ledger is append-only and the balance is DERIVED.** Nothing is ever edited in place. A reversal is a **new opposing entry**. `saldo = Σ amount_idr WHERE status='available'` — computed, never stored. | A stored balance can drift from the entries that explain it. A derived balance cannot. The book must be replayable and auditable. | `grep -rn "update ledger_entries" apps/ packages/` → only the `pending → available` **release** (a status transition, not an amount edit) | **MET** |
| **SEC-5** | **Double-credit is a database impossibility, not an application hope.** Three partial unique indexes: `ledger_one_sale_per_payment`, `ledger_one_sale_per_order`, `ledger_one_retur_per_order`. | Gateway callbacks retry. Buttons get double-clicked. Check-then-write races lose. | `select indexname from pg_indexes where tablename='ledger_entries';` | **MET** |
| **SEC-6** | **A number on screen must be traceable to a query.** No constant, no `Math.random()`, no seeded PRNG, no back-solved "adjustment" line may be rendered as if it were data. If we cannot count it, the UI says **"Belum terhubung"** or shows an empty state. | A fabricated ROAS could have led a merchant to raise a real ad budget against a return that never happened. A fabricated `ship7d_avg` recommended waiving a Rp275rb/mo subscription. Invented line items showed a merchant products the customer never bought. | `grep -rn "mulberry32\|Math.random" apps/*/lib apps/*/app apps/*/components` | **PARTIAL** — no fabricated number reaches a screen (verified), **but `apps/admin/lib/mock/store.ts` still exists and still contains 6 `mulberry32` generators**. It is imported by ~10 client components, almost entirely **for its TypeScript types** (`type Product`, `type Customer`, …) plus three residual constants (`TODAY`, `PRODUCTS`, `BLOG_CATEGORIES`). It is a loaded gun on the shelf: the file is one careless import away from putting invented data back on a screen. Extract the types, delete the generators. |
| **SEC-7** | **Money decisions never trust buyer-typed input.** COD's province gate resolves the province from `orders.ship_district_id` → `kiriminaja_areas`, never from `address.provinsi`. If the district cannot be resolved, COD is **refused**. | A hostile client types "DKI Jakarta" and ships to Papua. The district id is what the parcel is actually booked against and cannot disagree with where the package goes. | `grep -n "provinceForDistrict" apps/admin/app/api/public/order/route.ts` | **MET** |
| **SEC-8** | **The security boundary is the server action, not the UI.** `requireCapability(cap)` is the **first statement** of every mutating server action. `useCan` / `<Can>` gating is convenience and secures nothing. | The UI is a suggestion. The API is the contract. | `for f in apps/admin/lib/actions/*.ts; do grep -q requireCapability $f \|\| echo $f; done` | **MET (for the money paths)** — 18 of 24 action files gate with `requireCapability` (billing.ts joined 2026-07-15). Six do not: `auth.ts` + `register.ts` (**correct** — pre-session by definition), and `profile.ts`, `security.ts`, `rekening.ts`, `payment-settings.ts`, which are self-service reads/writes on the caller's own identity and are defensible. **`billing.ts` is now gated**: `createSubscriptionPayment` and `cancelSubscriptionInvoice` call `requireCapability("settings:write", {allowSuspended:true})`, so a `gudang` user can no longer touch the subscription bill. |
| **SEC-9** | **Platform operator roles are enforced.** `requirePlatformAdmin(min)` ranks `support < admin < owner` and compares. | The role was carried in the JWT and **never read**: a `support` operator could reject payouts, reset passwords and impersonate a merchant. | `grep -n "RANK\|requirePlatformAdmin" apps/super-admin/lib/platform-auth.ts` | **PARTIAL** — enforced at the **action** layer only. Middleware/pages check for *a* session, not a role. `invitePlatformAdmin` is now `owner`-gated with a **whitelisted `role`** and is audit-logged (2026-07-15) — the escalation is closed. |
| **SEC-10** | **Impersonating a merchant is audited.** `impersonateStore` requires `owner` and writes `platform_activity`. | It previously required only "logged in" and left **no trace at all**. Someone reading a merchant's orders must be a fact on the record. | `grep -n "logStore" apps/super-admin/lib/actions.ts` around `impersonateStore` | **MET** |
| **SEC-11** | **Every action that moves money or changes identity is audit-logged** to `platform_activity` with `kind='admin'`. | An unlogged privileged mutation is indistinguishable from an attack. | read `apps/super-admin/lib/actions.ts` and check each export | **MET** (2026-07-15) — `setInvoiceStatus`, `setStoreUserRole`, `saveGateways`, `saveCodAllowed`, `createStore` and `invitePlatformAdmin` now all write to `platform_activity` (`logStore`/`logPlatform`), joining the add/remove/reset user + payout actions that already did. No silent privileged mutation remains among the store-lifecycle/billing/settings actions. |
| **SEC-12** | **The shopper never sees a provider brand** (ADR 0004). The storefront receives `{code, label, kind}` only — never "AutoLaris", never "KiriminAja". | The platform's supplier relationships are ours, not the merchant's, and not the shopper's. | `grep -rni "autolaris\|kiriminaja" apps/storefront/src` → zero hits in rendered output | **MET** |
| **SEC-13** | **A link that restores personal data must be SIGNED, never a raw id.** The abandoned-checkout recovery link is an HS256 JWT `{sid, st}` — store-bound, 7-day expiry, secret `CHECKOUT_RECOVERY_SECRET ?? AUTH_SECRET`. | Clicking it restores a stranger's **name, phone and address**. `/checkout?sid=<session id>` would be a bearer credential over that data the moment the link is forwarded, screenshotted, or leaks via `Referer` — and the ids are already echoed in every tracking beacon. Guessing is not the main risk; leakage is. | `apps/storefront/src/lib/recovery.ts` — `verifyRecoveryToken` rejects a token whose `st` ≠ the Host-resolved store; **then** `grep -rn "signRecoveryToken" apps packages` | **VACUOUSLY MET — NO LINK IS EVER MINTED** (corrected 2026-08-01; previously read "MET", which implied the merchant's recovery link is signed when there is no recovery link at all). What IS true: there is **no raw-id path** anywhere, and the verifier is correct and store-bound — so the requirement cannot be *violated*. What is NOT true: `signRecoveryToken` has **zero callers** in all four apps, and the WA message (`apps/admin/lib/data/checkout.ts#cartMessage`) fills only `{nama, produk, toko}` into a `keranjang` template body carrying **no link placeholder**. The merchant's recovery message therefore contains no way back to the cart, and the storefront restore path (`verifyRecoveryToken` → "Selamat datang kembali" banner → basket restore → field pre-fill) is **unreachable code**. ⚠️ When it IS wired, the mint must stay this shape — signed, store-bound, 7-day, **never a raw session id**. Tracked in `BACKLOG.md`. |
| **SEC-14** | **A rate must not count an ordinary sale as a save.** `rescued = abandoned_at IS NOT NULL AND recovered_at IS NOT NULL`. A checkout that never went quiet is a sale, not a recovery. | A straight-through checkout also ends as `status='pulih'`. The naive `pulih / (pulih + ditinggal)` reports **19,3%** (190 / 982) on the local data where the honest formula reports **11,2%** (100 / 892) — it would tell a shop it "rescued" every ordinary sale it ever made. Same family as SEC-6: a number that looks real and is wrong is worse than no number. | `apps/admin/lib/data/checkout.ts#getCheckoutMetrics` — both `rescued` counters filter on `abandoned_at is not null` | **MET** — migration 0045 exists for exactly this |

---

## 2. Functional requirements

### 2.1 Tenancy & identity

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-T1 | One database, many stores. A store is the tenant (`stores.id`), carried as `store_id` on **45** tables (44 of them under RLS). | `select count(*) from stores;` → 7 (local seed) | MET |
| F-T2 | A merchant signs in with email + password against `users` ⋈ `store_users`. Password = scrypt `salt:hash`, compared with `timingSafeEqual`. | `apps/admin/lib/auth.ts` | MET |
| F-T3 | The session is a **jose HS256 JWT in an httpOnly cookie** (`session`), verified at the edge by `middleware.ts` without a DB round-trip. | `apps/admin/middleware.ts` | MET |
| F-T4 | Platform operators are a **separate table and a separate cookie** (`platform_admins` / `platform_session`). A merchant login can never reach the control plane. | two distinct cookie names, two distinct verify paths | MET |
| F-T5 | A merchant can self-serve sign up at `/daftar`, which provisions a store in **one transaction** (`accounts`, `users`, `stores`, `store_users`, `locations`, `store_settings`, `store_stats`, `platform_activity`). | `apps/admin/lib/provision.ts` | MET |
| F-T6 | Google OAuth sign-in exists behind a feature flag; the routes redirect when the env is unset. | `apps/admin/app/api/auth/google/*` | **UNVERIFIED** — the code path has **never been run against real Google credentials** |
| F-T7 | Four merchant roles — `owner`, `admin`, `staff`, `gudang` — with the capability matrix in `lib/rbac-policy.ts`. | see UML §7.1 | MET |

### 2.2 Catalog & inventory

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-C1 | Products have real variants (`product_options` → `product_variants`) and per-location stock (`inventory_levels`). | `select count(*) from product_variants;` → 96 | MET |
| F-C2 | `inventory_levels.available` is the **only** stock number. Checkout, cancel, retur, PO-receive and the Inventori editor all write it and nothing else. | `grep -rn "inventoryLevels" apps/admin/lib/actions apps/admin/app/api` | MET |
| F-C3 | Checkout **decrements stock at order creation** and rejects a cart that exceeds `available` **before writing any row**. | `apps/admin/app/api/public/order/route.ts` — the stock check precedes the first insert | MET |
| F-C4 | Deleting a product that history references is an **archive** (`status='archived'`), not a delete. Archived rows are filtered out of the read layer. | `apps/admin/lib/actions/products.ts` | MET |
| F-C5 | Product media uploads land on disk (`public/uploads/`) + a `product_media` row, 5 MB image cap. | `apps/admin/lib/actions/media.ts` | MET — local disk. MinIO/S3 is the VPS plan |

### 2.3 Orders

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-O1 | `order_status` is exactly `baru \| diproses \| dikirim \| selesai \| batal \| retur`. | `\dT+ order_status` | MET |
| F-O2 | Every transition's effect on inventory, payments and the ledger is as specified in [`UML.md` §3.1](./UML.md), executed in **one transaction**. | `apps/admin/lib/actions/orders.ts` | MET |
| F-O3 | `batal` **and** `retur` both restore inventory, guarded on the previous status so a repeat click cannot double-restore. | code + `UML.md` §3.1 | MET |
| F-O4 | An order carries the address it was **shipped to** (`orders.ship_*`, migration 0042) — a snapshot, not a lookup into `customer_addresses`. | `select count(ship_address) from orders;` → 685 | MET |
| F-O5 | The Pesanan list is a seller centre: 6 tabs (`Semua`, `Belum Bayar`, `Perlu Dikirim`, `Dikirim`, `Selesai`, `Pengembalian/Pembatalan`), server-side search/filter/paging, real counts. | `apps/admin/components/admin/pesanan/order-list-types.ts` | MET |
| F-O6 | **The five status tabs are a strict partition** — every order is counted once and none is missed. | `0 + 24 + 23 + 595 + 43 = 685 = count(*)` — verified tab by tab against SQL | MET |
| F-O7 | The order detail shows the **real** line items, ongkir, payment method, courier and address. No value on that page may be derived from a hash of the order id. | `apps/admin/lib/data/order-detail.ts` | MET — as of `2a5ffc4`. It previously fabricated all six, incl. a back-solved "Penyesuaian" line that made the invented items reconcile to the real total |

### 2.4 Money — payments, ledger, payouts

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-M1 | A **`sale` is booked when money is COLLECTED** — a `payments` row reaching `berhasil` — and nowhere else. Not at order creation, not at bill creation, not at despatch. | `apps/admin/lib/ledger-credit.ts#creditSaleForPayment` | MET |
| F-M2 | The ledger credits `payments.amount_idr`, **never `payments.total`** (which includes the gateway's admin fee). | same file | MET |
| F-M3 | **COD is booked at the door**, not at checkout: the payment stays `menunggu` and becomes `berhasil` only when the order reaches `selesai` (`collectCodOnDelivery`). A refused parcel goes `batal`/`retur`, which **fails** the pending payment. | `settleOrderLedger` | MET |
| F-M4 | A sale is **released** to `available` when the order reaches `platform_payout.release_on` (default **`selesai`**, and it is actually read). | `settleOrderLedger` reads `platform_payout` | MET — fixed in `0776e99`; it previously hardcoded `selesai` while the toggle changed nothing |
| F-M5 | Releasing at `dikirim` must remain **possible but discouraged**: a parcel can only be returned after it shipped, and on COD the cash does not exist at despatch. | the super-admin toggle carries the warning | MET |
| F-M6 | A merchant can request a withdrawal; **only an `owner`** can (`settings:write`); it is refused below `platform_payout.min_payout_idr` (Rp50.000) and above the available balance; bank details must exist first. | `apps/admin/lib/actions/ledger.ts#requestPayout` | MET |
| F-M7 | Concurrent withdrawals are **serialised per store** by `pg_advisory_xact_lock(hashtext(store_id))` inside the transaction. | same file | MET |
| F-M8 | Bank details are **snapshotted onto the payout**, so editing the account later cannot rewrite where past money went. | `payouts.bank_*` | MET |
| F-M9 | A platform operator can `processPayout` → `markPayoutPaid` (**no ledger write** — the merchant was debited at request time) or `rejectPayout` (**an opposing `adjustment`** computed from `Σ ledger_entries WHERE payout_id = ?`, never from `payouts.amount_idr`). | `apps/super-admin/lib/actions.ts` | MET |
| F-M10 | Subscription billing: 3-day trial → **Rp50.000** first month → **Rp275.000/mo** (annual Rp2.700.000). Prices are the **DPP (ex-tax)**; the merchant pays base + **PPN 11%**. | `packages/lib/src/billing.ts` | MET |
| F-M11 | **VIP = `stores.comped`** — free, always active, never billed, never suspended. Honoured by both `getBilling` and the billing cron. | `packages/lib/src/billing.ts` | MET |
| F-M12 | There is **one plan**. Plan tiers (Pemula/Bisnis/Skala) must not be reintroduced. | `plans` table and `plan_key` enum are LEGACY and unread | MET |

### 2.5 Shipping & COD

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-S1 | The courier roster is **synced live from KiriminAja** into `platform_couriers`, with per-service `{type, name, group, cod, codAllowed}`. | super-admin `/pengaturan` → `syncCouriersFromKiriminaja` | MET |
| F-S2 | A courier KiriminAja stops offering is **disabled, never deleted** — old orders still reference it. | same action | MET |
| F-S3 | Shipping control is two-level and the merchant's level is **per service**, not per courier: the platform sets the enabled courier pool, the merchant picks the individual services offered at checkout. `effective = platform-enabled ∩ store_shipping_methods`, keyed `"<courier>:<service_type>"` (a service_type is only unique within its courier). **No picked rows = the merchant never opened the card → fall back to courier-level**, never a checkout with zero shipping options. | `apps/admin/app/api/public/ongkir/route.ts` · `saveStoreServices` in `apps/admin/lib/actions/shipping.ts` | MET — as of `35b88a4`. It previously filtered on `store_settings.couriers` (the COURIER list) while the Jasa Kirim card promised *"Pilih layanan yang ditawarkan ke pembeli saat checkout"* and wrote to `store_shipping_methods`: **14 rates came back for 11 picked services**, 4 of them never enabled (Jagopack, Sicepat CARGO, BIGPACK, SAP One Day). After: **10** |
| F-S4 | COD requires **all five conditions** (UML §5), enforced server-side in `/api/public/order` **before any row is written**. | 403 + zero rows on any failure | MET |
| F-S5 | `store_settings.cod_enabled` defaults to **false** — a merchant opts *in* to COD. | migration 0038 | MET |
| F-S11 | The `cod` flag on a rate returned by `/api/public/ongkir` is the **effective** one — KiriminAja's capability **×** the platform's per-service `codAllowed` **×** this store's `cod_enabled` — never the raw courier capability. So the storefront can only ever advertise COD where the order API would actually allow it. | `apps/admin/app/api/public/ongkir/route.ts` → `getCodPolicy(store.id).allows(...)`. In a browser: 10 rates, COD badge on **SPX Standard (Rp17.000)** and **SPX Economy (Rp12.700)** only; AnterAja selected ⇒ no COD payment option; SPX selected ⇒ "COD (Bayar di Tempat)" appears | MET — exercised in a real browser (0 console errors), not typechecked |
| F-S6 | `orders.awb` holds **only a waybill the courier actually issued**. Our own booking reference goes in `orders.ka_order_id`. | `apps/admin/lib/actions/shipping.ts:402` — `const awb = r.awb ?? null` | MET — fixed in `0b3cdda`, which had been printing our order id on parcels under "No. resi" |
| F-S7 | The KiriminAja **sandbox never issues an AWB**, so `awbPending: true` is the expected dev outcome and the UI must say so rather than look broken. | `kaCreateOrder` returns `awbPending` | MET |
| F-S8 | The COD return-rate report must be readable **per courier**. | `select count(courier) from orders;` → **1 of 700** | **NOT MET** — a regular checkout books no shipment, so `orders.courier` is NULL on almost every row and the report collapses into one "Tidak diketahui" bucket. **This is the number the whole COD policy is betting on.** |
| F-S9 | The "SPX free return" premise on which the SPX-only COD policy rests is **true**. | ask KiriminAja, in writing | **UNVERIFIED** — free returns are a *Shopee Seller Center* benefit; we reach SPX through *KiriminAja*, a different contract, and its API has **no return field at all**. If returns are in fact billed through KiriminAja, the policy's rationale collapses. |
| F-S10 | A COD fee (`platform_cod.fee_pct`) can fund a return pool, allowing COD to widen beyond one courier. | `grep -rn "fee_pct\|feePct" apps packages` → **2 hits: the schema and the seed** | **NOT MET** — the column exists, is seeded to `0`, and **nothing reads it**. There is no COD fee. |

### 2.6 Storefront

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-F1 | **One SSR deploy serves every tenant**, resolved from the `Host` header (ADR 0009). | `apps/storefront/src/middleware.ts` | MET |
| F-F2 | A host naming an **unknown** slug returns a clean **404** — never another merchant's shop. | `getStoreByHost` returns null → 404 page | MET |
| F-F3 | `astro build` runs **without a `DATABASE_URL`** — the image must build when the DB is unreachable. | build with the env unset | MET |
| F-F4 | The storefront writes real funnel events to `analytics_events`: 5 types, `store_id` from the **Host** and **never** from the client. | `apps/storefront/src/pages/api/track.ts` | MET |
| F-F5 | `/api/track` is guarded by a bot-UA filter (an **empty UA counts as a bot**) and a per-IP rate limit (30 / 60 s). | same file | **PARTIAL** — both guards are **per-process in-memory**. They do not hold across replicas, and there is no proof-of-work, signature or session check. A distributed script with a browser UA can still inflate the funnel. |
| F-F6 | The merchant's blog posts appear on their storefront. | `grep -rn "articles\|blogs" apps/storefront/src/pages/blog/` | **MET** (2026-07-14) — `/blog` reads `articles` (`content.ts`, per-tenant, `status='terbit'` hard-filter → drafts 404); `/blog/[handle]` + `/halaman/[handle]` detail routes exist. |
| F-F7 | Each store shows its own contact details. | `apps/storefront/src/pages/kontak.astro` | **PARTIAL** (2026-07-15) — WhatsApp is per-store (`stores.whatsapp`, set in Pengaturan → Profil; no shared dummy). Email is still shared (no per-store column, no mailer) |
| F-F8 | A merchant assembles their storefront from a curated section registry (ADR 0009), and what they build is what ships. | `@tokophi/sections` is imported by both the Puck editor and the Astro renderer | MET |
| F-F9 | Checkout is **locked and uniform** across every store (branding tokens only). | ADR 0009 | MET |

### 2.7 Platform control plane

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-P1 | Every headline number on a super-admin screen is computed from `orders` / `products` / `invoices` / `ledger_entries` — **never** from `store_stats`. | `grep -rn "storeStats" apps/super-admin/lib/data.ts` → reads: none | MET — as of `571ed17`. The rollup disagreed with reality by up to **140×** |
| F-P2 | The platform can see **what it owes each merchant** (the merchant float) as a **liability**, not as revenue. | super-admin dashboard | MET |
| F-P3 | Payout approval exists and someone can act on the queue (`/pencairan`). | super-admin route | MET |
| F-P4 | Per-store control: comp a month, extend trial, VIP toggle, reset passwords, manage users, suspend/activate. | `apps/super-admin/lib/actions.ts` | MET |
| F-P5 | The panel must not **recommend giving away revenue** on the basis of a number it cannot compute. | the `ship7d_avg` banner ("Volume tinggi — jadikan VIP gratis?") was driven by a metric with **no source at all** | MET — removed in `571ed17` |
| F-P6 | Metrics we cannot support (churn, shipments/day, COD exposure, GMV/province, MoM deltas) are **stated as unsupported**, not faked. | super-admin dashboard | MET |

### 2.8 SEO

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-E1 | Both admin surfaces (Seller + Super Admin) are `noindex, nofollow` in **three layers** (`next.config.ts headers()`, `middleware.ts` re-stamp, `metadata.robots` + `app/robots.ts`). | `curl -sI https://app.tokophi.com/login \| grep -i x-robots` | MET |
| F-E2 | `/api/uploads/*` is **carved out** (`X-Robots-Tag: all`) — merchant product photos must stay in Google Images. | `apps/admin/next.config.ts` | MET |
| F-E3 | The landing page and every storefront remain fully indexable, with `robots.txt` + a generated `sitemap.xml` + an OG social card. | `apps/landing/public/robots.txt`, `src/pages/sitemap.xml.ts`, `public/og.png` | MET |
| F-E4 | `www.tokophi.com` 301s to the apex. | Traefik redirect router | MET |

### 2.9 Customers & abandoned checkout (migrations 0044 / 0045)

| ID | Requirement | Verify | Status |
|---|---|---|---|
| F-K1 | **Buying never requires an account.** `customers.registered_at IS NULL` = **guest**, and guest is the *normal* case, not a defect — a registration wall in front of an Indonesian checkout loses the sale. The UI says `Tamu` in a neutral badge, never an error state. | `select count(*) filter (where registered_at is null) from customers;` → **17 guest / 7 registered** (local seed) | MET |
| F-K2 | The identity that carries a customer is the **phone**, not the email: Indonesian shoppers hand over a WhatsApp number far more readily, and every follow-up travels on WhatsApp. | `apps/admin/lib/data/customers.ts`, `checkout.ts` (phone-first ranking) | MET |
| F-K3 | **Abandoned checkouts are captured.** Indonesia abandons 82–83% of carts (research; ~70% globally) and we recorded **none** — while the CRM already showed `keranjang` follow-ups pointing at baskets that did not exist. | `select count(*) from checkout_sessions;` → **994** | MET — `checkout_sessions` (0044) |
| F-K4 | Capture is **progressive** — the row is written *as the shopper types* (debounced beacons), because there is **no "abandon" event**: abandonment is the absence of an order. Upsert on `(store_id, session_id)`; `step` only ever moves **forward**; a `pulih` row is never resurrected by a late beacon. | `apps/storefront/src/pages/api/checkout-session.ts` — the `setWhere status <> 'pulih'` and the `array_position` step guard | MET |
| F-K5 | The capture endpoint takes its tenant from the **Host header** (`locals.store`) and **never** from the body, is bot-filtered and rate-limited (60/min/IP), and **fails quiet** (204 + an `x-capture` reason header). A broken capture must never break a working checkout. | same file | MET |
| F-K6 | A session ages `aktif → ditinggal` after **60 minutes** of silence, stamping `abandoned_at = coalesce(updated_at, created_at)` — *the moment it went quiet*, not "now". Done by an opportunistic sweep in the capture endpoint (≤ once/min per SSR process). **No cron.** | `sweepAbandoned()`; `select count(*) from checkout_sessions where status='ditinggal';` → **792** | MET |
| F-K7 | "Recovered" means **this session became that order** — stamped in `/api/public/order` (`status='pulih'`, `recovered_order_id`, `recovered_at`, `customer_id`), not inferred from "we sent a WhatsApp and they bought something later". The write is non-fatal: a paid order must never fail because a marketing table did. | `apps/admin/app/api/public/order/route.ts` | MET |
| F-K8 | The four screen metrics are `count`/`sum` only — no modelled or estimated number — over a 30-day window, with `aktif` sessions excluded from **both** sides: `abandonRate = ditinggal / (ditinggal + orders)`, `recoveryRate = rescued / (rescued + ditinggal)`. Local: **792 / 198 / 100** → **80,0%** and **11,2%**. | `apps/admin/lib/data/checkout.ts#getCheckoutMetrics` | MET — see **SEC-14** for why `rescued ≠ pulih` |
| F-K9 | Recovery is a **WhatsApp `wa.me` deep link**, and the recorded follow-up says only *"kontak dibuka"* (`followups.sent_at`, `status='menunggu'`) — **never `terkirim`**. We cannot observe delivery or read, so we do not claim them. | `apps/admin/lib/actions/checkout.ts#recordCartContact` (gated `crm:write`) | MET |
| F-K10 | A merchant with no phone number on a cart is **told so** (the `Anonim` tab), rather than shown a list that implies every cart is actionable. Tab counts are the **true SQL totals**, not the length of the loaded slice. | `apps/admin/app/(admin)/pelanggan/keranjang/keranjang-client.tsx` | MET |
| F-K11 | A shopper account system (login, order history, saved addresses) on the storefront. | `customers.password_hash` exists (0044); `grep -rn "passwordHash" apps/storefront/src` | **NOT MET** — the column is provisioned and **nothing reads it**; `/akun` is still a non-functional demo form (see F-F7's neighbourhood) |

---

## 3. Non-functional requirements

| ID | Requirement | Verify | Status |
|---|---|---|---|
| NF-1 | **Money is `bigint` whole rupiah.** Never a float, anywhere. | `select count(*) from information_schema.columns where table_schema='public' and column_name like '%_idr' and data_type <> 'bigint';` → **0** | MET |
| NF-2 | **Determinism in render paths.** No `Date.now()` / `Math.random()` where SSR and client must agree — a hydration mismatch is a bug, not a warning. | the `/bantuan` hydration bug was exactly this | MET |
| NF-3 | **Console-clean.** `npm run build` passes and the dev overlay shows **0 issues**. | `npm run build:admin && npm run build:super` | MET |
| NF-4 | **Bahasa Indonesia UI, IDR, `id-ID` formatting** throughout. Storefront slugs are Indonesian (`/produk/`, `/kategori/`, `/blog/`, `/halaman/`). | inspection | MET |
| NF-5 | **shadcn/ui runs on Base UI, not Radix.** Triggers use `render`, not `asChild`. Do not use `Select`. `Button` as a link needs `nativeButton={false}`. | `AGENTS.md` | MET |
| NF-6 | **Public API rate limits**: ongkir 60/min/IP · order 10/min/IP · pay 20/min/IP · callback 60/min/IP · track 30/min/IP · **checkout-session capture 60/min/IP**. | `apps/admin/lib/public-guard.ts`, `apps/storefront/src/pages/api/checkout-session.ts` | **PARTIAL** — all limiters are **in-process**. They do not survive a restart and do not hold across replicas. The production answer is the Cloudflare edge. |
| NF-7 | **Accessibility AA**; responsive down to cheap-Android widths. | inspection | PARTIAL — no formal audit has been run |
| NF-8 | **Zero-downtime storefront deploys**, which requires the DB-free build (F-F3). | deploy | MET |
| NF-9 | **Automated tests.** | `npm test` (vitest is wired at the root); `find . -name '*.test.ts' -not -path '*/node_modules/*'` | **NOT MET** — vitest is configured and there is **exactly one test file** in the entire repo (`packages/lib/src/integration-status.test.ts`). `verify-rls` / `verify-rls-app` are the only other automated checks, and they cover tenancy only. **Nothing automatically tests the ledger, the COD gate, or the order state machine** — the three places where a bug costs money. This is the single largest process gap in the project, and it is why `select sum(…) for update` (which Postgres rejects outright, breaking *every* withdrawal) shipped: `tsc` cannot see inside a SQL string. Nor can `astro check` see inside a client `<script>` — a `ReferenceError: queueSave is not defined` in `checkout.astro` blocked the **entire rate load** (no rates → no COD → **no order at all**) with typecheck, lint and build all green. **Money and checkout paths must be exercised in a browser, not typechecked.** |
| NF-10 | Secrets never in the repo. `AUTH_SECRET`, `AUTOLARIS_*`, `KIRIMINAJA_*`, `CRON_SECRET`, `DATABASE_URL` come from env. | `.env` is gitignored | **MET** (2026-07-16) — `AUTH_SECRET` no longer falls back to a dev string in production: `@tokophi/lib/secret` throws (fail-closed) if it is unset/short and `NODE_ENV=production`, and only returns the dev key in development. Lazy, so builds (which run without the runtime secret) are unaffected. |
| NF-11 | `KIRIMINAJA_ENV` **defaults to `sandbox`.** | `packages/lib/src/kiriminaja.ts` | **MET, but a trap**: an unset env in production silently talks to the sandbox and books no real parcels. |

---

## 4. Explicit non-goals

| Non-goal | Why |
|---|---|
| **Themes menu / free-form theme editor** | The builder is a **curated section registry**, not arbitrary HTML/CSS/Liquid. Checkout stays locked and uniform. |
| **Apps / plugins marketplace** | The feature set is curated in-core. |
| **Plan tiers** | One plan, all features. Pemula/Bisnis/Skala are legacy and must not return. |
| **Merchant-chosen payment gateway** | Payments are platform-managed (ADR 0004). The merchant enables *methods*, not providers. |
| **Exposing provider brands to merchants or shoppers** | ADR 0004. Generic labels only. |
| **A merchant-facing payment fee-bearer setting** | **It does not exist.** `payment-fees.ts` has zero importers. If it is wanted it must be **built into checkout pricing**, not merely stored in a column. |
| **Supabase** | Prod target is self-hosted Postgres on a VPS (ADR 0007). |

---

## 5. How to check the big ones in 60 seconds

```bash
# SEC-1/2 — tenancy fails closed
docker exec tokophi-db psql -U tokophi -d tokophi -c \
  "set role tokophi_app; select count(*) from orders;"          # expect 0

# SCHEMA — the counts this doc set has been wrong about three times
docker exec tokophi-db psql -U tokophi -d tokophi -c \
  "select count(*) filter (where relrowsecurity) as rls, count(*) as tables
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r';"                # expect 44 / 68

# SEC-4/5 — the book cannot double-credit
docker exec tokophi-db psql -U tokophi -d tokophi -c \
  "select indexname from pg_indexes where tablename='ledger_entries';"

# SEC-6 — no fabricated numbers in a render path
grep -rn "mulberry32\|Math.random" apps/*/lib apps/*/app apps/*/components | grep -v node_modules

# SEC-3 — money endpoints fail closed
grep -n 'NODE_ENV === "production"' \
  apps/admin/app/api/public/pay/callback/route.ts \
  apps/admin/app/api/cron/billing/route.ts
```
