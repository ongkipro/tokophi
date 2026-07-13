# TokoΦ — STATUS: what is real, what is seeded, what is still fake

> **Why this file exists.** This project has a documented history of numbers that looked real and were not:
> a fee-bearer feature that was never implemented, an ad-performance dashboard with no integration behind it,
> a courier roster that contradicted the API, a Saldo chip that showed `sum(payments)` as if all of it were
> withdrawable, and a ledger that nothing ever credited. The rule below is **verify or say you did not**.
>
> Checked **2026-07-13** against the source tree and the live database (`tokophi-db`, 64 tables, 42 migrations).
> Companions: [`SYSTEM_MAP.md`](./SYSTEM_MAP.md), [`FLOWS.md`](./FLOWS.md).

Three categories, and the distinction matters:

- 🟢 **REAL** — DB-backed, wired end to end, verified by reading the code *and* querying the table.
- 🟡 **SEEDED-BUT-COMPUTED** — the *maths* is honest and the query is real, but the **rows are demo data**. Point it at
  live traffic and the number becomes true with no code change. This is not a lie; it is a fixture.
- 🔴 **FAKE / NOT WIRED** — the UI asserts something the system cannot know, or the control saves a value nothing reads.

---

## 1. 🟢 REAL — verified

| Thing | Evidence |
|---|---|
| **Multi-tenant RLS** | 39 tables have `relrowsecurity = true` in `pg_class`. Policy on each: `USING (store_id = app_current_store_id())`. Two roles exist (`tokophi`, `tokophi_app`); `tokophi_app` holds 256 table grants. `withTenant()` sets the GUC **and** `SET LOCAL ROLE tokophi_app`, so the policies enforce at runtime, not just on paper. Only one `store_id` table lacks RLS: `platform_activity` (deliberate). |
| **The ledger** | `ledger_entries`: 645 rows — 595 `sale/available` (Rp209.374.000), 47 `sale/pending` (Rp18.436.000), 2 `payout/available` (−Rp17.345.000), 1 `adjustment/available` (+Rp12.345.000). Balance is **derived**, never stored. Append-only. Three partial unique indexes (`ledger_one_sale_per_payment`, `…_per_order`, `ledger_one_retur_per_order`) make double-credit a DB impossibility, not an app hope. |
| **Payout request race** | `requestPayout()` computes the balance inside the same txn under `SELECT … FOR UPDATE`. Two concurrent requests serialise instead of both passing the check. |
| **Payout rejection** | `rejectPayout()` posts an **opposing `adjustment` entry**, computed from `Σ ledger_entries WHERE payout_id = ?` (not from `payouts.amount_idr`), inside a `FOR UPDATE` txn, with a mandatory reason. Confirmed live: the rejected Rp12.345.000 payout has its matching `+12345000` adjustment. |
| **Order lifecycle → inventory** | `setOrderStatus`: `batal` **and** `retur` both restore stock, guarded on the previous status so a repeat click cannot double-restore. Both fail any still-`menunggu` payment. |
| **Order lifecycle → ledger** | Release on `selesai` only. `retur` writes an opposing entry carrying the **same status as the sale it reverses** (so returning a still-`pending` sale cannot drive the available balance negative). |
| **COD gate** | Five conditions, all read, all enforced **server-side before any row is written** (`lib/cod.ts` + `/api/public/order`). The province is derived from the **KiriminAja district id** the quote was issued for, not from the buyer-typed `address.provinsi`. Unverifiable district + a non-empty allow-list ⇒ **403, fail closed**. |
| **Payment callback auth** | Constant-time compare; **returns 401 in production when `AUTOLARIS_CALLBACK_SECRET` is unset**. Idempotent via a `status <> mapped` predicate. |
| **Auth** | scrypt (`salt:hash`) + `timingSafeEqual`; jose HS256 JWT in an httpOnly cookie; edge middleware verifies without a DB hit. Two separate cookies (`session` / `platform_session`) so an admin login never grants control-plane access. |
| **RBAC** | `requireCapability(cap)` is the first statement of every mutating admin action. `settings:write` is owner-only ⇒ **only an owner can withdraw money**. |
| **Suspension** | Real-time: `requireCapability` calls `getBilling()` and throws `SuspendedError` past the grace period. `support:write` opts out. |
| **Storefront multi-tenancy** | `Host` → store, memoised 15 s. An unknown slug 404s rather than serving another merchant's shop. `RESERVED` labels never resolve as slugs. **`astro build` is DB-free.** |
| **Courier roster** | 12 rows in `platform_couriers`, synced from KiriminAja's live `shipping_price` response. Two-level control: `effective = (merchant ?? all) ∩ platform-enabled`. Stale couriers are disabled, never deleted. |
| **Analitik / Pelanggan / Pemasaran aggregates** | Every figure is a counted row from `orders` / `order_line_items` / `products`, RLS-scoped. A store with no orders gets zeros and an empty state, not a fabricated number. |
| **Topbar notifications** | Counted (`orders WHERE status='baru'`, low stock from `inventory_levels`). They used to be two hardcoded strings, one of which alerted the merchant about "Earphone TWS" — a product from an old electronics catalogue that this fashion store never sold. |
| **Public API rate limits** | ongkir 60/min, order 10/min, pay 20/min, callback 60/min, storefront `/api/track` 30/min — all per-IP. |
| **Self-serve signup** | `/daftar` → `lib/provision.ts`: one transaction writes `accounts`, `users`, `stores`, `store_users`, `locations`, `store_settings`, `store_stats`, `platform_activity`. |

---

## 2. 🟡 SEEDED-BUT-COMPUTED — honest maths, demo rows

These are **not** lies. The query is real and RLS-scoped; the rows underneath are fixtures. Say "demo data", never "fake".

| Thing | The maths | The rows |
|---|---|---|
| **Conversion funnel + device split** (`/analitik`) | Real `GROUP BY type` / `GROUP BY device` over `analytics_events`, day-bucketed so the range switcher actually changes the numbers. Reconciles with the KPIs beside it **by construction**: `visit` events == `analytics_daily.visitors`, `purchase` events == `analytics_daily.orders`. It replaced two hardcoded constants (`FUNNEL = 18.816 kunjungan…`, `DEVICE_SPLIT = 78/18/4`) that were identical for every store. | **47.804 seeded rows** (visit 24.287 · product_view 15.337 · add_to_cart 5.466 · checkout_start 2.072 · purchase 642), spanning 2026-03-04 → 2026-07-01. A **real writer now exists** (`apps/storefront/src/pages/api/track.ts`), so live traffic accumulates on top with no query change — but today's chart is overwhelmingly seed. |
| **Dashboard / Analitik series** | Real `SELECT` from `analytics_daily` (122 rows). | Seeded rollup. |
| **Ledger balances** | Real derivation from real entries. | The 645 entries were backfilled by migration `0041` from the **seeded** `payments`/`orders`. The maths is exact; the money is demo money. |
| **Store catalogue** | 7 stores, 14 products, 700 orders, 685 payments — all real rows in real tables. | Seeded (`packages/db/src/seed.ts`, 1.034 lines, anchored to `TODAY = 2026-06-30`). |
| **Super-admin health verdicts** (`lib/health.ts`) | A fixed formula (`100 − fails*40 − warns*15`) over **real** signals. | Thresholds (14/30 days, `OVERDUE_DAYS = 14`) are hardcoded constants. Derived, not fabricated — but not tuned either. |

---

## 3. 🔴 FAKE / NOT WIRED — the honest list

### 3.1 Money and policy

| # | What | Detail |
|---|---|---|
| 1 | **`platform_payout.release_on` is never read.** | The super-admin `/pencairan` UI lets an operator flip release from `selesai` to `dikirim`, saves the row, logs it, and warns about the risk. **`settleOrderLedger()` hardcodes `if (status === "selesai")`.** The toggle changes nothing. Migration `0040`'s own header claims it is "kept as a platform SETTING so it can be loosened without a deploy" — it cannot be. (The code is doing the *safe* thing; it just is not doing what the setting says.) |
| 2 | **`platform_payout` is empty in the live DB (0 rows).** | `0040` inserts the policy row, but the seed truncates it and does not re-insert. So `min_payout_idr` falls back to the hardcoded `50_000` in both `lib/actions/ledger.ts` and `lib/data/ledger.ts`. `savePayoutPolicy` upserts, so the first operator save fixes it — but out of the box, the policy table does not exist. |
| 3 | **`platform_payout.auto_approve`** | Read into `PayoutPolicy` and typed. **No action writes it, no UI shows it, no code branches on it.** Dead field. |
| 4 | **`platform_cod.fee_pct`** | In the schema, seeded to `0`. **Grep across `apps/` + `packages/` returns exactly two hits: the schema definition and the seed.** Nothing reads it. There is no COD fee. |
| 5 | **`platform_cod.max_amount_idr` / `allowed_provinces` have no super-admin UI.** | They **are** enforced (`lib/cod.ts` reads both, and the seed sets Rp2.000.000 + 6 provinces), but super-admin's `/pengaturan` only ever writes `platform_cod.enabled`. The UI copy there claims *"Ditanggung platform; limit & area diatur di sini"* — **that sentence is false.** Changing the cap or the provinces requires SQL. |
| 6 | **`packages/lib/src/payment-fees.ts` has ZERO importers.** | Grepped the whole repo. `PAYMENT_FEES`, `paymentFee()`, `FEE_BEARERS`, `splitFee()` are dead code. **A merchant-facing fee-bearer feature does not exist** and never did — `store_settings.payment_fee_bearer` is a column nothing consumes. ⚠️ **`CLAUDE.md` and `AGENTS.md` still describe this feature as if it shipped.** (`CHANGELOG.md` corrected it; the working-agreement files did not.) |

### 3.2 Shipping and orders

| # | What | Detail |
|---|---|---|
| 7 | **`orders.courier` is NULL on 700/700 rows. So is `awb`. So is `ka_order_id`.** | Only two code paths ever set them: the **instant** (same-day) leg of `/api/public/order`, and merchant-initiated booking in `lib/actions/shipping.ts`. A regular checkout books **no shipment** — the order is written and the parcel is arranged later, or not at all. **Consequence:** `lib/data/returns.ts` groups the COD return-rate by `orders.courier`, so every shipped order collapses into a single `"Tidak diketahui"` bucket. **The per-courier return-rate card cannot produce a per-courier number today.** |
| 8 | **The SPX free-return claim is UNVERIFIED.** | `lib/data/returns.ts` says so itself: TokoΦ restricts COD partly because a refused parcel is *said* to ship back free on SPX and to be billed to the merchant elsewhere — but that is a **Shopee Seller Center benefit**, and we reach SPX through **KiriminAja, a different contract**. The KiriminAja API exposes **no return field at all**. I could not verify it either. Until someone puts a number on it, "SPX only" is a guess wearing a policy's clothes. |
| 9 | **The courier roster comes from ONE reference route.** | `kaServices()` has no list-couriers endpoint to call, so it prices origin `2099` (Menteng) → dest `356` (Coblong), 1 kg, Rp100k and harvests the services out of the response (cached 24 h). **A courier that does not serve that lane is invisible to the roster.** |
| 10 | **`KIRIMINAJA_ENV` defaults to `sandbox`.** | Unset in production ⇒ the platform silently talks to `tdev.kiriminaja.com` and every rate is fictional. |
| 11 | **Parcel weight is hardcoded `qty × 500 g`.** | `checkout.astro`. Products have no weight column. Every ongkir quote is therefore approximate at best. |
| 12 | **The checkout province datalist is 11 hardcoded entries.** | It is a *suggestion*, not a constraint (the COD gate correctly ignores it in favour of the district id) — but it is not the real province list. |

### 3.3 Super-admin

| # | What | Detail |
|---|---|---|
| 13 | **The MRR chart is synthetic.** | `buildMrrSeries()` fabricates a 12-month uptrend with a seeded PRNG (`mulberry32(4242)`), then rescales it so the final point equals the current MRR. Hardcoded month labels. **There is no MRR history table.** The dashboard's "Pertumbuhan MRR" is a shape, not a record. |
| 14 | **Five of six dashboard deltas are hardcoded `0`.** | `getDeltas()` returns `gmv: 0, activeStores: 0, newSignups30d: 0, churn: 0, arpu: 0`. The sixth (`mrr`) is computed **from the synthetic series above**, so the "+X% MoM" badge is derived from fabricated data. `getPlatform().churnRate` is also a hardcoded `0`. |
| 15 | **Two different MRR formulas on one page.** | `getPlatform().mrr = activeNonComped × BILLING.MONTHLY_IDR` (ignores the Rp50k first-month promo). `getSubscriptionStats().mrr` honours it. Both render on the dashboard. **They can disagree with each other.** |
| 16 | **`TODAY = new Date("2026-07-02T00:00:00Z")`** is a frozen constant in `apps/super-admin/lib/data.ts`. | Every "N hari lalu" on invoices, activity, health, and every 30/60/90-day window in `getStoreMoneySignals` is measured from it, **not** from `Date.now()`. Only `getPayouts()` uses the real clock. Relative times in the control plane drift further from truth every day. |
| 17 | **`requirePlatformAdmin()` never checks `role`.** | It asserts only that a `platform_session` exists. `platform_admins.role` (`owner`/`admin`/`support`) is **decorative**: an invited `support` operator can reject payouts, reset any merchant's password, and impersonate any store. |
| 18 | **`invitePlatformAdmin` hashes the fixed password `tokophi123`.** | Every invited operator starts with the same well-known credential, and there is no forced rotation. |
| 19 | **Audit gaps.** | These mutate and write **nothing** to `platform_activity`: `impersonateStore`, `createStore`, `setStorePlan`, `setInvoiceStatus` (money-adjacent), `invitePlatformAdmin`, every `/pengaturan` mutation (channels, gateways, couriers, COD), and every ticket action. **Impersonation being unlogged is the one that matters most.** |
| 20 | **`sendPaymentReminder` sends nothing.** | It writes an audit line and returns `ok`. There is no email and no WhatsApp integration anywhere in the codebase. |
| 21 | **`getPlanDistribution()` + `lib/mock.ts#PLANS`** | The stale 3-tier catalogue (pemula 99k / bisnis 299k / skala 799k), which contradicts the single-plan model. Dead code, but still exported and still typed into `Store.plan`. Relatedly, `/api/cron/billing` writes `planKey: "bisnis"` onto every renewal invoice. |
| 22 | **`region: "Singapore"`, `"Coolify"`, `IDR(275_000)`** | Hardcoded strings/numbers on `/analitik` and the dashboard price card, instead of reading config / `BILLING`. |
| 23 | **No login rate limit or lockout on `/login`** (either panel). | `AUTH_SECRET` also silently falls back to `"dev-insecure-secret-change-me"` when unset. |

### 3.4 Storefront

| # | What | Detail |
|---|---|---|
| 24 | **`/blog` is four hardcoded articles in a source literal.** | Titles, excerpts, dates ("24 Juni 2026"), images. The `blogs` and `articles` tables — which the merchant admin *writes* — are **never read by the storefront**, and there is no `/blog/[handle]` detail route. The merchant's blog editor publishes into a void. |
| 25 | **`/akun` is a non-functional demo form.** | `onsubmit="event.preventDefault()"`, with the text "Demo — sistem akun aktif setelah backend terhubung." **There is no shopper account system.** |
| 26 | **Every store shares one WhatsApp number and one tagline.** | `DEFAULT_WHATSAPP = "6281234567890"`, `DEFAULT_TAGLINE = "Busana wanita modern — batik & ready-to-wear"` in `src/data/store.ts` — `stores` has no such columns. `/kontak` and `/keranjang` link every merchant's shoppers to that fake number. `/kontak` also hardcodes `halo@batiknusantara.id`. |
| 27 | **Custom domains are a `return null` stub.** | `slugFromCustomDomain()` is documented as resolution step 1 and does nothing. There is no `stores.custom_domain` column. The `domains` table exists in the schema and is read by nothing. |
| 28 | **`SECTION_DEFAULTS` ships fake testimonials.** | `packages/sections/src/registry.ts` seeds a dropped Testimoni section with `{name: "Sari", quote: "Bahannya adem, jahitan rapi. Repeat order terus!", rating: 5}` and a Marquee reading "Gratis Ongkir Se-Indonesia · Kualitas Premium · COD Tersedia". **A merchant who drops a section and never edits it publishes fabricated reviews and a free-shipping claim on a live storefront.** |
| 29 | **`astro.config.mjs` has `site: "https://batiknusantara.id"`** — the demo tenant's domain baked into a multi-tenant app's canonical `site`. |
| 30 | **Homepage featured products are three hardcoded handles** (`dress-batik`, `gamis-syari`, `dress-midi-bunga`), with a `slice(0,3)` fallback. `/kategori/` adds two hardcoded virtual collections (`semua`, `promo-gajian`). |

### 3.5 Public API

| # | What | Detail |
|---|---|---|
| 31 | **`/api/cron/billing` fails OPEN when `CRON_SECRET` is unset.** | The guard is `if (secret && provided !== secret) return 401`. **No secret ⇒ no check.** The endpoint is excluded from the auth middleware matcher, so an unset env var leaves an unauthenticated route that iterates every store and creates VA invoices. Compare `/api/public/pay/callback`, which was *deliberately* changed to fail closed in production for exactly this reason. This one was not. |
| 32 | **`/api/public/*` runs on the owner connection, outside RLS.** | Necessarily — the shopper has no session, so there is no `app.store_id` GUC to set. `store_id` is resolved from the client-supplied `storeSlug`. **Tenant correctness on the checkout path — the path that writes orders, payments and inventory — rests entirely on application code.** This is the single largest RLS hole in the system and it is on the most security-sensitive path. |
| 33 | **`POST /api/public/pay` is dead.** | `PUBLIC_PAY_API` is declared in `apps/storefront/.env.example` and read by no storefront source file. The route still accepts unauthenticated requests to create real gateway bills. |
| 34 | **Storefront `/api/track` has only a per-IP window + a UA regex.** | 30 events / 60 s and a ~40-pattern bot-UA filter (empty UA ⇒ bot). Both are **per-process in-memory** — they do not hold across replicas. **No proof-of-work, no signature, no session validation.** A distributed script with a browser UA can inflate any store's funnel. (`store_id` is Host-derived, so it cannot inflate *someone else's* funnel from the wrong host — that part is sound.) |
| 35 | **`/api/uploads/[name]` is public and unauthenticated by design** (storefronts embed the images) and has no rate limit. The filename regex `^[a-zA-Z0-9._-]+$` does block traversal. |
| 36 | **`ADMIN_BASE` for product images is derived from `PUBLIC_ONGKIR_API`'s origin.** | Change the ongkir URL and every merchant's product photography silently moves. Load-bearing coupling with no test. |

### 3.6 Data quality

| # | What | Detail |
|---|---|---|
| 37 | **`orders.province` is NULL on 700/700 rows.** | The checkout only ever fills `city`. `lib/data/analytics.ts` knows this and correctly aggregates "Penjualan per wilayah" by city — but any province-level analysis is impossible. Note the **COD** province check does *not* depend on this column (it uses the district id), so the gate is unaffected. |
| 38 | **No `retur` orders and no `cod` payments exist in the seed.** | `orders.status`: 610 `selesai`, 43 `batal`, 22 `dikirim`, 15 `diproses`, 10 `baru`, **0 `retur`**. `payments.method`: 685 rows, **all `transfer`**. So the return-rate card, the COD-collection path (`collectCodOnDelivery`), and the retur claw-back have **no demo data to exercise them** — they are verified by reading the code and the migrations, not by observing seeded rows. |
| 39 | **Stale comments in the source.** | `lib/data/analytics.ts` says `analytics_events` "has ZERO rows and NO writer anywhere in the codebase" (it has 47.804 and a writer). `lib/data/funnel.ts` says the tracker "is still open (BACKLOG P1.8)" (it shipped). `packages/db/src/schema.ts` says "Nothing writes here from the app yet". All three are now wrong. |
| 40 | **`lib/nav.ts` hardcodes a `badge: "7"` on Pesanan.** | It is not a count of anything. The live DB has 10 orders in `baru`. |

---

## 4. Things I could NOT verify

Stated plainly rather than guessed.

1. **The SPX free-return claim** (item 8). Second-hand, contradicted by the contract path (KiriminAja ≠ Shopee Seller Center), and the API exposes no return field. Nobody has put a number on it.
2. **Whether AutoLaris and KiriminAja behave as documented in production.** Both clients are written against vendor docs; I did not call either live API. `KIRIMINAJA_ENV` defaults to `sandbox`, and there is no assertion anywhere that production is not silently running against `tdev.kiriminaja.com`.
3. **The AutoLaris callback signature spec.** The endpoint uses an interim shared secret; the code notes it should be swapped for the vendor's real HMAC signature "once the vendor confirms the signing spec". I found no evidence that spec has been received.
4. **Google OAuth against real Google credentials.** Feature-flagged; the routes redirect when env is unset. `CHANGELOG` says it was never exercised against real credentials, and I found nothing to contradict that.
5. **Production RLS behaviour under `tokophi_app`.** The local catalog proves the policies exist and `withTenant` proves they are applied. Prior sessions claim it was proven live in production; I verified the *local* DB only.
6. **Whether the live production DB matches this local one.** All counts above are from local Docker `tokophi-db`. Migration `0041` is the newest here; I did not check what production has applied.
7. **`apps/super-admin` is being actively edited as I write this** (uncommitted changes in `lib/actions.ts`, `lib/data.ts`, and a new `toko/[id]/saldo-section.tsx`). §3.3 reflects the working tree at the time of reading and may already be stale.

---

## 5. If you fix five things, fix these

Ordered by how badly the system lies or leaks, not by effort.

1. **`/api/cron/billing` fails open** (item 31) — an unset env var leaves an unauthenticated endpoint that generates invoices. One-line fix; same class of bug that was already fixed on the payment callback.
2. **`requirePlatformAdmin()` ignores `role`** (item 17) + impersonation is unlogged (item 19). A support operator can move money and become any merchant, and nothing records it.
3. **`orders.courier` is always NULL** (item 7) — the COD return-rate card, the number the entire COD policy is betting on, cannot compute. Book the shipment (or record the courier) at checkout.
4. **`release_on` is a toggle that does nothing** (item 1) — either wire it or delete it. A control that silently no-ops is worse than no control.
5. **The storefront blog publishes into a void** (item 24) and every store shares one WhatsApp number (item 26). A merchant is paying Rp275rb/month for a shop whose contact button reaches someone else.
