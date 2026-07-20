# TokoΦ — STATUS: what is real, what is seeded, what is still fake

> **Refreshed 2026-07-21** against the source tree and the live database
> (`docker exec tokophi-db psql -U tokophi -d tokophi`) — **72 tables, 64 migrations (0000–0063),
> RLS on 46** (0058 added `stores`, which is keyed by `id` and which `verify-rls` structurally cannot see).
> 0062 adds `orders.problem_at`/`problem_note` (stuck-parcel flag); 0063 adds `stores` public address +
> phone + 5 social handles (footer). Front-end shipped this pass: product search (`/cari`), responsive
> `srcset` with an allow-listed on-demand resizer, a sale-recovering 404, URL-driven sort, the social
> footer, and a11y (skip link, reduced-motion, 44px targets). Core Web Vitals measured excellent on prod
> mobile 3× (LCP 348–552ms, CLS 0). ⚠️ The #15 local-`main` divergence is RESOLVED as superseded — see
> BACKLOG; do not resurrect those 25 commits.
> ⚠️ The local DB reports **68** applied migrations against 62 files on this branch: the Postgres container is
> **shared with other worktrees** that carry their own migrations. Count files on your branch, not rows in `drizzle`.
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

## 0. Storefront `/checkout` — state as of 2026-07-17 (read before touching it)

**Everything below was driven in a real browser, not typechecked.** `astro check` is green on every bug
in this section — that is why it is stated separately from "it builds".

### 🟢 SHIPPED AND LIVE on `tokophi.com` (verified in the deployed HTML, not from a status field)

- **Pengiriman is ONE focused row** — the named default `spx`/type `1` (SPX Standard). SPX Economy, JNE
  and everyone else sit in "Pilih ekspedisi lain". **No SPX on the route → JNE takes the default slot
  and the box says so.**
- **The cheapest rate is never hidden.** The full list is prefetched in the background once the fast
  quote paints; anything genuinely cheaper than the default is promoted to a **second row** with a
  "Termurah" badge. Two rows max, `all:true` fires once, the disclosure never opens itself.
  · Verified live on **Sukodono/Sidoarjo**: 1 row (SPX Standard Rp7.000) → SPX Economy Rp5.600 promoted
  with no click; "Pilih ekspedisi lain (6)"; 8 services total; 0 console errors.
- **`<form novalidate>` + Indonesian validation messages.** The browser's native bubble follows the
  BROWSER's language, not `lang="id"` — an Indonesian on an English phone was told *"Please fill out
  this field."* Verified live: all messages are ours.
- **The input rules do NOT over-validate** — 40+ cases, all green: 13 real Indonesian names, phone
  prefixes `0838/0881/0895/0851` (normalising to `62…`), university/self-hosted/plus-addressed emails,
  `Blok C2/14` and `RT.001/RW.009` addresses.

- **The focus trap is FIXED and LIVE** (`6f95ac0`, merged in PR #6, deployed 2026-07-17). It was: a
  typo in the **optional** email field (`siti@gmail`) dragged focus back on blur, so the shopper's
  address was typed into the email box (`alamat=""`,
  `email="siti@gmailJl. Melati No. 12 RT 03 RW 05"`) and `Tab` was trapped. `reportValidity()`
  **focuses** the control, by spec — it is now inline `<p data-err>` + `aria-invalid`, and blur never
  touches focus. **Never call `reportValidity()` on blur here again** (AGENTS.md).
- **Jurnal section on the homepage** (`233370b`, live): the 9th section type, above the closing CTA.
  Renders **nothing** until an article is published — verified against a store with zero.

### ✅ DEPLOYED — PR #7 merged (`dfe1631`, 2026-07-18) and verified live

**Blog featured images as a real feature.** This section was written while the PR was a draft; it landed
and `1810d8f` records the production check (15 articles on `batik-nusantara.tokophi.id/blog`,
`/api/uploads/jurnal-*.webp` → 200 `image/webp`, absolute `og:image`, 15 `media` rows, migrations 0058–0061
applied on prod). **Kept for the reasoning, not the status** — the ⚠️ about `tokophi-uploads` mounting on the
`migrate` service is a standing deploy rule, not a PR note. What it fixed:

- The editor's "Gambar unggulan" card was a **dead `<button>`** (no handler) that also lied — *"hingga
  5 MB"* against a 2 MB server cap. `ArticleInput` had no `imageUrl`, so **no merchant could ever give
  an article a picture**; only the seed could.
- Underneath it: `lib/data/articles.ts` never selected `body`, so the editor fabricated
  `${excerpt}\n\n${title}` and **every Simpan deleted the article's real text** (908 chars → ~60 on the
  demo). ⚠️ **This delete is still live until PR #7 lands** — but it is only reachable by a merchant
  who opens an article and saves it, which is why it is here and not above.
- Demo journal reseeded: **16 articles (15 published + 1 draft), 15 images, 228 KB / 15 KB each**, all
  through the upload pipeline and into Files.
- ⚠️ PR #7 also mounts `tokophi-uploads` on the **`migrate`** service. Without it, `seed-journal`
  writes 15 WebPs into an ephemeral container and production gets 15 media rows pointing at 404s —
  while the deploy log says success. **Do not deploy `seed-journal` without that mount.**

### 🟡 KNOWN AND DELIBERATE — not defects, do not "fix" them

- **`KIRIMINAJA_ENV=sandbox` on live → every rate on `tokophi.com` is FICTION.** Sandbox courier
  coverage is arbitrary: the same key returns `jne:REG23` for a Yogyakarta origin and **no JNE at all**
  for Surabaya. This is why "JNE is enabled in the dashboard but never shows" was reported — the
  platform ∩ store filter is correct (live offers exactly 10 enabled ∩ what the route returns = 8).
  **Owner decision, tracked in `BACKLOG.md` §🔴.** Flipping it makes rates AND bookings real.
- **COD vanishing outside the 6 allow-listed provinces is correct** (verified: Papua shows no COD).
- **Guest checkout with no account is the normal case**, not a defect.

---

## 1. 🟢 REAL

| Thing | Evidence |
|---|---|
| **Multi-tenant isolation** — ⚠️ *partial, and this row used to overstate it* | 46 tables `relrowsecurity = true`; non-owner role `tokophi_app`; `platform_activity` is the only `store_id` table without a policy, deliberately. No tenant context ⇒ **0 rows**. **But counting RLS'd tables does not prove isolation.** The other 24 tables are the risk: `product_options`, `inventory_levels`, `collection_products`, `collection_conditions`, `order_line_items`, `product_media` carry **no `store_id` and RLS `f`** (verified in `pg_class`, not assumed). **Fixed `e61df25`** for `updateProduct`/`updateCollection`/`deleteCollection`, which deleted-and-rewrote those children keyed on a **client-supplied parent id** — RLS silently no-op'd the parent UPDATE while the child writes went through, so `products:write` was enough to wipe another store's variants and inventory. Each now reads its parent under RLS first and bails. ⚠️ **`e61df25` fixed the instances it found, not the class** — auditing every writer of an un-RLS'd table on 2026-07-20 turned up **four more of the same bug**, all shipped: `media.ts` (`e9656fd`), `deleteDiscount`, `createPurchaseOrder`, `syncChildren` (`30a3c71`). **The rule now lives in AGENTS.md** with the full 11-table list. See §4b |
| **The ledger** | 642 entries live. Balance **derived** (`Σ amount_idr` by status), book **append-only**, 3 partial unique indexes make double-credit a DB impossibility |
| **Sale credited on collection** | `creditSaleForPayment` fires only when a `payments` row reaches `berhasil`, and credits `amount_idr` — never `total`, which adds the gateway's fee |
| **COD booked at the door** | `collectCodOnDelivery` flips the payment at `selesai` **and** sets `financial_status='dibayar'` (cash in hand); `batal`/`retur` **fail** the pending payment, so cash never collected is never booked. **Fixed `5f61034`** — the door was previously unreachable: every order is created `pending`, only the AutoLaris callback flips it, **COD has no callback**, and Perlu Dikirim + the tab counts + bulk shipping all gated on `= 'dibayar'`. **COD — the dominant channel — never entered the shipping queue at all** and showed permanently "Belum Bayar". Readiness is now derived from `payments.method='cod'`, never from `financial_status` |
| **The release rule is read** | `settleOrderLedger` reads `platform_payout.release_on` (default `selesai`). **Fixed `0776e99`** — it was hardcoded, so the super-admin toggle saved a value and changed nothing |
| **Payout request race closed** | `pg_advisory_xact_lock(hashtext(store_id))` inside the txn. (It was `FOR UPDATE` over an aggregate, which Postgres rejects outright — **every withdrawal threw**) |
| **Payout rejection is exact** | the opposing `adjustment` is computed from `Σ ledger_entries WHERE payout_id = ?`, never from `payouts.amount_idr` — so it cannot over- or under-refund |
| **Order lifecycle → inventory** | `batal` **and** `retur` both restore stock. **Fixed `9772246`** — the old guard was `prevStatus !== status`, which stopped only an identical repeat: `batal`→`retur` restored a **second** time, `batal`→`diproses` revived a cancelled order with nothing decremented, and `prevStatus` was read with a plain `SELECT`, so two concurrent changes both restored. Now `FOR UPDATE`, same-status is a no-op, and `batal`/`retur` are **terminal**. ⚠️ The lock is in `setOrderStatus` **only** — `ka-tracking.ts:81` (the poller) still reads the status unlocked, so poller-vs-manual is not serialized |
| **Order lifecycle → ledger** | release only at `selesai`; the claw-back **carries the status of the sale it reverses**, so returning a still-pending sale cannot drive the balance negative. **Fixed `9772246`** — `batal` reversed **nothing**, so a prepaid order cancelled after its payment had credited the sale left **withdrawable money in the book for a refunded order**. `batal` now reverses too, sharing `retur`'s one-reversal-per-order index |
| **COD five-condition gate** | server-side in `/api/public/order`, **before any row is written**. Province resolved from the KiriminAja district id, never from the typed address. Fail-closed 403 |
| **COD is ON, end to end** | Three switches agree: `platform_cod.enabled` (cap **Rp2.000.000**, **6** allow-listed provinces) · `platform_couriers.services[].codAllowed` = **SPX only** (SPX Standard `type=1` + SPX Economy `type=3`; every other courier is `codAllowed=false` **even where KiriminAja reports `cod=true`**) · `store_settings.cod_enabled = true` for batik-nusantara (default **false** — the merchant opts in). Seller switch: Pengaturan → Pengiriman → "Bayar di Tempat (COD)", with a green **COD** badge on the two SPX rows in Jasa Kirim. **Driven end-to-end in a real browser** (0 console errors): 10 shipping options, the COD badge on the two SPX ones only; AnterAja → no COD payment option; SPX → "COD (Bayar di Tempat)" appears. The `cod` flag on a rate is the **effective** one (KiriminAja capability × platform per-service allowance × the store's `cod_enabled`), never the raw courier capability. ⚠️ **"End to end" is an overstatement and it cost us three bugs.** The browser run covered **rate display → payment-option picker** and stopped at the Bayar button. Everything downstream was unverified, and all of it was broken: `5f61034` (COD never entered the shipping queue), `521861d` (the order could commit with **no payment row** — the exact row `collectCodOnDelivery` looks for). **A COD path is not verified until a parcel is booked, delivered and the cash collected** |
| **Checkout offers exactly the services the seller picked** | **Fixed `35b88a4`** — `/api/public/ongkir` filtered on `store_settings.couriers` (the COURIER list) while the Jasa Kirim card promises *"Pilih layanan yang ditawarkan ke pembeli saat checkout"* and writes to **`store_shipping_methods`** (per service). So **every service the seller switched OFF was still offered**: 14 rates came back for Batik Nusantara's 11 picks, 4 of them never enabled (Jagopack, Sicepat CARGO, BIGPACK, SAP One Day). Now **(platform-enabled couriers) ∩ (merchant's per-service picks)**, keyed `"<courier>:<service_type>"` → **10**. No rows = the merchant never opened the card → fall back to courier-level, never a checkout with zero shipping options |
| **Money endpoints fail CLOSED** | `/api/public/pay/callback` **and** `/api/cron/billing` both 401 in production when their secret is unset. **The cron was fixed `0776e99`** — it read `if (secret && provided !== secret)`, so no secret meant *no gate*, on a route excluded from auth that bills every store on the platform |
| **Auto-renewal and manual renewal charge the same price** | **Fixed `9dc99bf`** — the billing cron billed the bare `quote().amount` (Rp275.000) for both the gateway amount and the stored invoice, while the interactive path billed `withPpn(q.amount).total` (Rp305.250) — and the Langganan page printed *"termasuk PPN 11%"* over both. **Every automatic renewal under-collected the 11%.** All three invoice-creating paths now agree (`lib/actions/billing.ts:83`, `super-admin/lib/actions.ts:385`, `cron/billing/route.ts:73`). Invariant: `subscription_payments.amount_idr` and every gateway amount are **PPN-inclusive** — never bill or persist `q.amount` raw |
| **An order and its payment row are written together** | **Fixed `521861d`** — both payment inserts ran **after** the order txn committed, so a blip left a committed order (line items written, stock decremented) with **no payment row**: a COD order `collectCodOnDelivery` can never find, or an AutoLaris order whose gateway bill has no row for the callback to match → **the shopper retries and buys the cart twice**. The row is now inserted inside `tx` (COD full; AutoLaris a pending shell enriched after). ⚠️ **Typechecked, not browser-exercised** — the commit itself asks for that before prod. See §4 |
| **Public API fails closed on tenant resolution** | **Fixed `7cc1ecc`** — `/api/public/order` and `/ongkir` resolved the tenant with `body.storeSlug \|\| "batik-nusantara"`, silently attributing a slug-less request to the **demo store**. Both now return "Toko tidak dikenali.". This is #29 (`/api/public/*` runs on the owner connection, outside RLS) **no longer hypothetical** — it is exactly "application code passed the wrong `store_id`", shipped and live. ⚠️ The flip side: a caller that ever omits the slug now gets a **dead checkout** instead of a wrong one — verify every caller sets it |
| **Shipment status follows the courier, and only the courier's contract code moves money** | **Fixed `ee8a458`** — the poller collapsed **any** unmapped status to `"shipped"`, so a delivered parcel reporting an off-map code pinned at `dikirim` **forever → COD never collected, merchant never credited**. Unmapped is now `null` (fill the AWB, change nothing). `outcomeFromTrackingCode` also accepts **text** (KiriminAja may send it) but text can advance no further than `shipped` — never delivered/returned, because a text-inferred `selesai` would collect COD cash and credit the ledger **on a guess**. `createShipment` books at `diproses` (a booking is not a shipment; it used to write `dikirim` with a null AWB, so the buyer saw "Dikirim" with no resi); `cancelShipment` resets to `diproses` instead of leaving a permanent "shipped with no shipment" |
| **Stock writes target one location** | **Fixed `b1f3603`** — the create-path decrement and the `batal`/`retur` restore both did `where variant_id = X`, hitting **every** `inventory_levels` row of the variant; the schema's `unique(variant, location)` is built for many, so the first second warehouse makes every sale subtract N×. Both now resolve one row by `locations.is_default desc, id`. `cancelPurchaseOrder` also refuses to cancel a **`diterima`** PO (it had already added the stock; deleting it stranded that stock with no PO behind it). ⚠️ **Two writers still location-blind** — see §4 |
| **The bulk stock editor cannot clobber a concurrent sale** | **Fixed `bc2ebfd`** — `updateStock` wrote an **absolute** value captured at page load, so any sale or PO receipt between load and save was silently overwritten back up, **resurrecting sold units into oversell**. Now optimistic: client sends `expected`, server locks the default-location row `FOR UPDATE`, skips on mismatch and returns `{updated, skipped}` so the editor warns + refreshes. ⚠️ `expected` is typed **optional** and the guard is `typeof === "number"` — any future caller that omits it silently reverts to last-write-wins |
| **Platform operator roles enforced** | `requirePlatformAdmin(min)` ranks `support` 1 < `admin` 2 < `owner` 3. **Fixed `0776e99`** — the role was carried in the JWT and never read |
| **Impersonation is `owner`-only and audited** | `impersonateStore` writes `platform_activity`. **Fixed `571ed17`** — it previously required only "logged in" and left **no trace at all**. **Fixed again `cb17372`** — `571ed17` hardened the *front door* and the **exchange** was still open: `/impersonate` verified the handed-off token with a bare `jwtVerify`, and the token carried no `aud`, so **any session-shaped JWT signed with `AUTH_SECRET` — e.g. a stolen 7-day merchant cookie — could be redeemed for a fresh session.** Now `aud: tokophi:impersonate`, required by the route. ⚠️ The `aud` literal in `apps/admin/app/impersonate/route.ts` and `IMPERSONATION_AUD` in `apps/super-admin/lib/session.ts` are **two hand-copied strings across apps with no shared import** — nothing makes them drift loudly |
| **Every `jwtVerify` pins `algorithms`** — ❌ **NOT TRUE, do not believe this** | `cb17372`'s message claims it; **two calls were missed** and I checked all 9 by grep: `apps/super-admin/middleware.ts:24` (`jwtVerify(token, secret())`, **no pin — and it is the gate on the highest-privilege surface in the repo**) and `apps/storefront/src/lib/chat.ts:63` (audience set, no pin). Low practical risk with a symmetric key; listed because **the commit message is wrong and the next reader will trust it** |
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
| 20 | ✅ **Login rate limit** (2026-07-16) — both panels cap attempts per IP before the scrypt check (admin 15/min, super-admin 10/min; in-process, Cloudflare-edge move still tracked). `AUTH_SECRET` insecure fallback ✅ **fixed 2026-07-16** — `@tokophi/lib/secret` fails closed in production | |
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
| 39 | 🟡 **Six test files, 72 tests — but a plain `npm test` runs only 52** (this row said "one test file" until 2026-07-20; it was already false when written) | Measured, not counted by hand: `npm test` → **52 passed, 20 skipped**. The 20 skipped are `ledger-credit.test.ts` — **the money tests** — which need `TEST_DATABASE_URL` pointing at a throwaway DB (never the shared one) and **skip rather than fail without it**. That is a deliberate, well-documented choice so `vitest run` stays green on a machine with no test DB. ⚠️ **The consequence is the house pattern from AGENTS.md**: the suite guarding the ledger is the one least likely to ever run, and the run says "green" either way. Nothing in CI runs it — **there is no CI**. Run it explicitly: `TEST_DATABASE_URL=…/tokophi_test npx vitest run apps/admin/lib/ledger-credit.test.ts`. **Still untested at all: shipping/tracking state, public-API tenant resolution, inventory concurrency** |
| 40 | **`stores.plan` / `plans` / `plan_key` are legacy** | the product has **one** plan; the enum still defaults to `'pemula'` |
| 45 | 🔴 **Production went down hard on 2026-07-18 — and the watchdog could not see it** | The VPS disk hit **100%** (Coolify retains every per-deploy image: **204 images / ~129 GB**), Postgres **crash-looped** on its end-of-recovery checkpoint (`No space left on device` → PANIC), and the SSR storefront **503'd for ~2h while the container reported `Up (unhealthy)`**. Freed ~130 GB, Postgres recovered on its own, no data loss. Prevention shipped (`e84449e`): `ops/tokophi-docker-cleanup.sh` + a daily 03:30 UTC cron, DEPLOY.md "L1b". **The gap the incident actually exposed is NOT fixed:** L1 restarts a *dead* container and does nothing for an `Up (unhealthy)` one, and nothing watches **disk %** — the broom is installed, the witness is not. Cap Coolify's image retention at the source |

### 3.7 Abandoned-cart capture — what is NOT there yet (`d7fc92f`, `9206220`)

The capture itself is 🟢 (§1). These are its known gaps, stated rather than left to be discovered.

| # | Item | Detail |
|---|---|---|
| 41 | 🟡 **Merged and deployed** (this row said "production has none of this" until 2026-07-20 — stale) | `9206220` + `d7fc92f` are on `main`. **Not the same as working:** every count in §1/§2 is still local, and production went down hard on 2026-07-18 (#45). Re-verify against prod that rows are actually landing before calling it real |
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
8. **The COD + AutoLaris money paths after `521861d`.** The payment insert moved inside the order txn and
   the AutoLaris branch now writes a pending shell that a later UPDATE enriches. **Typechecked only** —
   and this repo's own rule is that money paths must be exercised in a browser, not typechecked.
9. **The text branch of `outcomeFromTrackingCode`** (`ee8a458`). The Indonesian/English regexes were written
   because KiriminAja's `status` "has been observed" as text — **no real payload was captured**. Log the raw
   `status` of every pull for a week, then rewrite the map from what actually arrives. Getting it wrong only
   ever strands a parcel (text cannot move money, by design) — which is exactly why nobody will notice.
10. **The optimistic bulk-stock skip path** (`bc2ebfd`). No concurrent sale has ever raced a save. Reproduce
    it deliberately (open the editor, order in another tab, save) before trusting the merchant sees a warning
    rather than a silent no-op.
11. **`ops/tokophi-docker-cleanup.sh` on the box** (`e84449e`). Committed and documented, but installed **by
    hand** to `/usr/local/bin` + `/etc/cron.d`. Nothing in CI reinstalls it, and unlike the watchdog it writes
    **no heartbeat** — a silently-removed cron is indistinguishable from a healthy one.

### 4c. 🔴 The resi (AWB) chain — scanned end-to-end 2026-07-20

**Booking is real and honest.** `request_pickup` works, and `awb: null` is never back-filled with a
booking reference. **Everything after booking is unproven.** `KIRIMINAJA_ENV` defaults to `sandbox` in
both compose files and every `.env.example`, sandbox never issues an AWB, and so the entire path from
`kaTrack` onward — the response shape, the numeric status table, the echo guard — **is inference nobody
has ever seen execute successfully.** `awbFilled` has never been observed non-zero.

Two things that must be settled before anyone claims the resi flow works, both in BACKLOG:

1. **We may be tracking with the wrong id.** We register our own `order_id` as `TOKOPHI-<ref>` at
   booking, then track using KiriminAja's `kj_order_id` passed under the key `order_id` — while their
   doc describes that field as `order_id string(max:20)`. Nothing has ever confirmed which one the
   endpoint wants. Cheapest available explanation for the AWB never landing; one real booking settles it.
2. **The vendor's two status scales contradict each other, and it is a money path.** Their webhook doc:
   `200` = picked up, `300` = delivered. Their tracking doc: `200` = Delivered. We map `200` → delivered.
   On the webhook scale that reads a merely-collected parcel as delivered — **collecting COD cash and
   crediting the ledger for goods still in transit.** Reading the docs harder cannot fix this; only a
   captured real payload can.

**There is no webhook** — no callback route, nothing calls their set-callback endpoint. Their
`processed_packages` event is the right mechanism for an async waybill, but the setup docs specify **no
signature, no HMAC, no IP allowlist**, so it may only ever be an *untrusted hint that triggers a verified
pull* — never an authority that moves money on an unsigned body.

Fixed this pass: `8cc7080` (a partial print run stamped un-labelled parcels as printed — they silently
never shipped; AWB-less orders vanished from the only screen that could recover them) and `3eefe02` (a
single non-JSON gateway reply aborted the whole sweep; the poller could starve orders forever; the run
summary went to `/dev/null`; three comments described a webhook, a poll and a rate limiter that do not
exist). Still open: no merchant-facing stuck-parcel flag, no retry/backoff/give-up/ageing, no pacing or
429 handling, and the shopper has no tracking surface at all.

### 4b. Found while reconciling this doc against the audit commits — six FIXED same day, three still open

These were not "could not verify". They were verified broken, in code, on 2026-07-20 at `d48413c` — and
then fixed the same session (`e9656fd`, `cae0deb`, `b37e762`, `d07aa1e`, `30a3c71`). Kept in full because
**how they were found is the reusable part**: `e61df25` patched three call sites it happened to find, and
auditing the *class* instead of the instances turned up four more of the same bug, one of which
(`deleteDiscount`) is a live cross-tenant DELETE that is harmless today only because the table is empty.

✅ **FIXED** — 1, 2, 3, 5, 6 below, plus three more the class-audit found: `deleteDiscount`,
`createPurchaseOrder`, `syncChildren` (`30a3c71`). The rule is now in AGENTS.md with the 11-table list.
✅ **ALSO FIXED, later the same day** — 4 (`ka-tracking`'s unlocked read → `dde9c09`, which also caught
`createShipment` checking terminal against a **pre-network** read) and the `api/public/order`
check-all-locations/decrement-one mismatch (`80fb83b`, plus `receivePurchaseOrder`'s read-then-write).
🔴 **STILL OPEN** — 7 (no PO undo path), 8 (ledger back-fill), and routing the two shipping status writes
through `applyOrderStatusChange` so there is one status writer rather than a state machine plus two
guarded raw updates. All carried in BACKLOG.

🛡️ **The verifier can now see this class.** `verify-rls` check **5c** (`b7cc5fd`) fails if a table with no
`store_id` and no RLS appears that is on neither the reviewed child-table list (11 today) nor the
platform/global list. It cannot prove an app-layer guard from SQL — nothing can — but it stops the class
growing silently, which is how all seven got in. **Its failure path was exercised, not assumed.**

🧪 **Exercised in a browser, not typechecked** (2026-07-20): production build, real Chromium, `en-US`
locale, admin on an isolated port. Login + Pesanan + Pembelian + Diskon + Kategori + Produk detail all
render with **0 console errors**; the Media card loads its 5 images, so the `media.ts` guard did not break
reads. The cross-tenant half was proved where it actually lives — under RLS in SQL: **96 own variants
visible, a foreign store's variant 0**. The shared demo DB was left byte-identical (row counts re-checked
against the baseline).

1. ✅ **FIXED `e9656fd` — `lib/actions/media.ts` had the un-RLS'd child-table hole `e61df25` closed elsewhere.**
   `product_media` has **no `store_id`** and **`relrowsecurity = f`** (checked in `pg_class`, not assumed).
   `uploadProductImage` INSERTs keyed on a client `productId`; `deleteProductImage` matches
   `(mediaId, productId)` against `product_media` **alone — it never joins `products`**. So a merchant with
   `media:write` can delete another store's product image. `e61df25` fixed three actions by hand and
   `media.ts` was not among them. **Apply the same guard: read the parent under RLS first, bail if absent.**
2. ✅ **DONE `30a3c71` — the writers of un-RLS'd tables are now enumerated, and the audit found three MORE live holes** (`deleteDiscount`, `createPurchaseOrder`, `syncChildren`).** `verify-rls` structurally cannot see
   them (it derives coverage *from `store_id` columns* — the same blind spot that hid `stores` until `0058`).
   This needs a written list of child tables + their writers, not three more hand-fixes.
3. ✅ **FIXED `cae0deb` — `apps/super-admin/middleware.ts:24` had `jwtVerify` with no `algorithms` pin**, on the highest-privilege
   gate in the repo. `cb17372` claimed "every `jwtVerify`"; it missed this one and `storefront/lib/chat.ts:63`.
4. **`ka-tracking.ts:81` reads `orders.status` with no `FOR UPDATE`**, so the tracking poller is not
   serialized against a manual status change — `9772246`'s lock is in `setOrderStatus` only.
5. ✅ **HOLE CLOSED `d07aa1e` (the side door remains) — `shipping.ts` wrote `orders.status` with a raw `db.update`, bypassing the state machine.**
   `cancelShipment` (line 645) sets `status:"diproses"` with **no status precondition** — on a `selesai`
   order (COD collected, ledger credited) or a `batal`/`retur` one it walks the status **backward**, straight
   through the terminal guard `9772246` just added. `createShipment` does the same unguarded write.
6. ✅ **FIXED `b37e762` — two inventory writers were location-blind** — `purchases.ts` (`receivePurchaseOrder`) and
   `products.ts` (`setInventory`) both pick a row with `limit(1)` and **no `is_default` ordering**. Same
   latent multi-location landmine `b1f3603` fixed on the other two paths, same one-line fix. Worse: the
   availability checks in `api/public/order/route.ts` still `sum(available)` **across all locations** while
   the decrement now touches one — under multi-location the check passes on the total and drives the default
   row negative.
7. **Cancelling a received PO is now refused and there is no undo path at all.** `b1f3603` correctly stopped
   the silent corruption, but the "undo = a separate stock adjustment" it points at **does not exist in the
   UI**. A merchant who receives a PO by mistake is now stuck with both the phantom stock and the record.
8. **The ledger back-fill nobody has run.** `batal` reverses going forward (`9772246`), but every prepaid
   order **already** cancelled in production still carries a withdrawable `sale` credit for a refunded order.
   Count them and decide. The one-reversal-per-order index makes a back-fill safe to re-run.

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
5. 🟡 **Tests for the ledger, the COD gate and the state machine — WRITTEN, and the ledger half does not
   run by default** (#39). 6 files / 72 tests, and they earned their keep: they caught three of the
   2026-07-18 audit bugs. But `npm test` executes **52 and skips the 20 ledger tests** unless
   `TEST_DATABASE_URL` is set. **Make the money tests run in a way somebody will notice** — a documented
   one-liner in the run docs at minimum, a CI job if one ever exists. The reasoning below is why, and it
   still stands.
6. **Close `media.ts`'s cross-tenant hole and enumerate the rest** (§4b.1–2). `e61df25` fixed three
   actions by hand; `product_media` (no `store_id`, RLS `f`) was missed and is writable by parent id
   from the client. Hand-fixing found bugs is not a strategy — **`verify-rls` cannot see these tables
   at all**, so the list has to be written by a human once.
7. **Browser-exercise the COD + AutoLaris money paths** (§4.8). `521861d` moved the payment
   insert inside the order txn — the single most important money change of the audit — and it has only
   been typechecked. By this document's own rule that is not verified.
8. **Stop `shipping.ts` writing `orders.status` raw** (§4b.5). `cancelShipment` can walk a `selesai`
   order backward to `diproses`, straight through the terminal guard `9772246` just added. A state
   machine with a side door is not a state machine.

Original reasoning for #5, kept because it is the house rule: `select sum(…) for update` — which
   Postgres rejects outright, so **every withdrawal threw** — shipped because `tsc` cannot see inside a
   SQL string. The same family, one week later: a `ReferenceError: queueSave is not defined` inside a
   client `<script>` in `checkout.astro` blocked the **entire rate load** — no rates → no COD → **no
   order at all** — while `astro check`, lint and build were **all green**; only opening the page in a
   browser caught it. **Money and checkout paths must be exercised, not typechecked.**
