# TokoΦ — System Guide

> **The one doc to understand the whole system.** What TokoΦ is, how the four surfaces fit
> together, the data/security model, the features, the integrations, and where it runs.
> For hands-on contributor setup see [`GUIDE.md`](GUIDE.md); for the DB see [`SCHEMA.md`](SCHEMA.md);
> for rationale see [`../decisions/`](../decisions/) (ADRs). Status is tracked in
> [`WORKLOG.md`](WORKLOG.md) + [`BACKLOG.md`](BACKLOG.md); changes in [`../../CHANGELOG.md`](../../CHANGELOG.md).

---

## 1. What TokoΦ is

**A Shopify-style commerce SaaS built for the Indonesian market.** A shared, modern-SaaS
**Seller** panel (`apps/admin`) runs many merchant stores; a **Super Admin** control plane
(`apps/super-admin`) is what the platform (us) uses to manage every store, plan, and integration;
**one multi-tenant Astro SSR storefront** serves every merchant, resolved from the `Host` header, and
merchants build their own homepage with the **self-serve section-based Store Builder** (ADR 0009).

> **Naming:** `apps/admin` = **Seller** (the merchant's panel — its UI says "Dashboard Seller") ·
> `apps/super-admin` = **Super Admin** (ours). Copy and docs say "Seller"; directories, packages,
> routes, env vars, DB columns and the store-user role `admin` keep their existing names.

**Deliberately opinionated — what it is NOT:**
- **No Themes menu, no Liquid, no theme marketplace.** Merchants customise via a **curated section
  registry** (Hero, Product Grid, …), not arbitrary HTML/CSS (ADR 0009 — which *supersedes* the older
  "storefronts are hand-built per client, not editable by merchants" line).
- **No Apps/Plugins marketplace.** Curated, lightweight feature set instead of an ecosystem.
- **Merchants never touch payment/courier credentials** — the platform owns them (see §4).

Tuned end-to-end for local sellers: **Bahasa Indonesia UI, IDR (no cents), WhatsApp/COD/QRIS,
local couriers, province-level reach** — with the polish of a modern SaaS (Linear/Vercel/Shopify-admin
quality, not a heavy ERP).

---

## 2. The four surfaces

| Surface | App | Who uses it | Tech | Port |
|---|---|---|---|---|
| **Seller** | `apps/admin` | merchant operators (owner/admin/staff/gudang) | Next 16 (App Router, Turbopack) + shadcn on Base UI | :3000 |
| **Super Admin** | `apps/super-admin` | the platform (us) | Next 16 + shared `@tokophi/ui` | :3001 |
| **Storefront** | `apps/storefront` | end shoppers | Astro + Tailwind v4, **SSR** — ONE deploy serves every store, tenant from the `Host` header (ADR 0009) | :4327 |
| **Landing** | `apps/landing` | visitors on the apex | Astro static — **no DB on purpose** (it must serve when the rest is down) | :4328 |

> **There are FOUR surfaces**, not three. Older docs said three and drew the storefront as SSG, built per
> client — both are wrong; the pivot to SSR multi-tenant is what makes the Store Builder (ADR 0009) possible.

Demo storefront = **"Batik Nusantara"** (women's fashion, 14 products with real Warna×Ukuran variants).
The platform seed has **7 stores** total (Batik + 6 demo stores) for the super-admin view.

---

## 3. Architecture at a glance

**Monorepo (npm workspaces):**
```
tokophi/
  apps/       admin/  super-admin/  storefront/  landing/
  packages/   ui/ (shadcn on Base UI + tokens)   lib/ (format, billing, couriers, kiriminaja, autolaris, validate)
              data/ (canonical nav — one source for admin builder + storefront header)
              db/ (@tokophi/db — Drizzle schema/client + migrations + seed)
              sections/ (@tokophi/sections — the Store Builder contract, ADR 0009)
  specs/      PRD, CODE_MAP, FLOWS, SCHEMA, STATUS, BACKLOG, ADRs, this guide
```

**Data flow (all four surfaces talk to ONE Postgres):**
- **Reads** go through server-only `lib/data/*` selectors; admin pages are `dynamic="force-dynamic"`.
- **Writes** go through `"use server"` actions in `lib/actions/*` (admin) / `lib/actions.ts` (super-admin).
- The storefront reads the same catalog at build/SSR via `@tokophi/db`.
- Shared nav lives in `@tokophi/data` (`MAIN_MENU`/`FOOTER_MENU`) — the admin menu builder and the
  storefront header consume the same source, so they stay in sync on rebuild.

---

## 4. The platform-managed model (ADR 0004)

**Payments and shipping are owned by the platform, not the merchant** — "terima matang":
- **Super-admin → Pengaturan = source of truth.** The platform configures payment gateways
  (**AutoLaris** — VA/QRIS/DANA) + **COD** + one shipping **aggregator (KiriminAja)** — once,
  centrally, applying to ALL stores. Credentials live at platform/account level (`platform_*` tables).
- **Merchant admin → Pengaturan = enable/disable only.** No credential fields; the merchant just
  toggles which payment methods to accept and picks which couriers/services (ekspedisi) to offer.
  Resi & tariffs are automatic. UI notes these are *"disediakan & dikelola oleh TokoΦ"*.
- **Money flow:** platform collects → settles/payouts to the merchant (fee/margin).

This is why shipping rates, resi, and label printing are a **KiriminAja** integration wired once
(super-admin config) and consumed by every merchant admin (see §8).

---

## 5. Data & multi-tenancy

**Local PostgreSQL 16 (Docker, port 5433) + Drizzle** (`@tokophi/db`) — **68 tables**, snake_case,
money = `bigint` IDR, **50 versioned migrations (`0000–0049`)**. Source of truth = `packages/db/src/schema.ts`;
annotated reference = [`SCHEMA.md`](SCHEMA.md). *(The shared dev container reports 69 — an unmerged branch's
`color_palettes` migration has been applied to it. Count against `schema.ts`.)*

**Row-Level Security (RLS) — enforced at runtime locally** (migration `0012_tenant_rls`, extended by 0032/0035/0036):
- `tenant_isolation` policy on **43 of the 44 store-scoped tables** — every table carrying a `store_id`
  except `platform_activity` (our audit log *about* tenants; deliberate). A row is visible when
  `store_id = app_current_store_id()` (a `STABLE` helper reading the `app.store_id` GUC).
- A non-owner Postgres role **`tokophi_app`** carries the policies.
- **The admin routes every query through the restricted role:** reads wrap in
  `withCurrentTenant(db => …)` (reads the session, sets the GUC, `SET LOCAL ROLE tokophi_app`);
  writes wrap in `withTenant(session.storeId, db => …)`. So tenant queries run as `tokophi_app`
  with RLS applied, even though the process connects as owner.
- **Deliberate owner exceptions:** auth (pre-session `store_users` read), super-admin (cross-tenant),
  the storefront (`Host`-resolved), `/api/public/*` (the shopper has no session — **the largest RLS hole,
  and it is on the checkout path**) and the billing cron. `verify-rls` + `verify-rls-app` prove isolation.
- **On the VPS** this becomes PostgREST connecting as `tokophi_app`, with the JWT `store_id` claim
  feeding the GUC (see §10).

> ⚠️ Any new admin DB code MUST use `withCurrentTenant`/`withTenant` — a bare module-level `db`
> runs as owner and bypasses RLS.

---

## 6. Auth & RBAC

- **Auth (local):** email/password → **jose JWT in an httpOnly `session` cookie** (`AUTH_SECRET`).
  `lib/auth.ts` (verify/findLogin/signSession/getSession), `middleware.ts` protects the admin.
  Passwords hashed with scrypt (`salt:hash`). Owner login: **ongki@batiknusantara.id / tokophi123**.
- **Super-admin auth is separate:** a distinct **`platform_session`** cookie + `platform_admins`
  table (migration 0013), login **admin@tokophi.id / tokophi123**. `requirePlatformAdmin()` gates
  every super-admin mutation.
- **RBAC (app-layer):** role→capability matrix in `lib/rbac-policy.ts` (client-safe). Every mutating
  server action calls `await requireCapability("<cap>")` (the security boundary; throws `ForbiddenError`).
  UI gates controls with `useCan("<cap>")` / `<Can>`; roles = **owner / admin / staff / gudang**.

---

## 7. Feature map

### Seller (`apps/admin`, merchant) — 16 modules, all DB-backed
Dashboard (KPIs, FB-style date range, charts) · **Pesanan** (list + detail with status pipeline +
**Cek Ongkir** live rates) · **Produk** (editor with real variants, + Kategori / Inventori / Pembelian
PO) · **Pelanggan** (+ detail / Segmen / Ulasan / **Keranjang Ditinggal**) · **CRM** (follow-up WA / pipeline / templates) ·
**Diskon** · **Analitik** · **Pemasaran** (per-provinsi, channel ROAS) · **Halaman** & **Blog**
(create+edit) · **Navigasi** (drag-and-drop menu builder) · **Pengaturan**. All 12 editors persist
via server actions; **CSV export** on every Ekspor button; **global search (⌘K)** returns real results.

### Super Admin (platform) — functional control plane
Dashboard (MRR/GMV + platform healthcheck rollup) · **Toko** (list + detail, health column/filter,
provisioning "Tambah toko", **impersonation** "Buka Dashboard Seller", suspend/activate, change plan) ·
**Paket** (invoices + mark paid/pending/failed) · **Analitik** · **Pengaturan** (payment gateways +
COD + KiriminAja courier config + "Tim Platform" operators). Composite **healthcheck** per store
(Sehat/Perhatian/Bermasalah + 0–100 score from billing/activity/stock/subscription signals).

### Storefront (shopper)
beranda · kategori (real collections + virtual "semua"/"promo") · **produk** (5-image gallery +
**real variant picker** → live price/stock) · **keranjang** → **checkout → sukses** — checkout now
**creates a real DB order** (customer + order + line items) with **live ongkir** + a **real payment**
(VA/QRIS/DANA) via the platform proxies; the order appears in the merchant admin and the pay callback
marks it paid. · akun · blog · kontak. Reads the same Postgres catalog.

**Buying never requires an account** — `customers.registered_at IS NULL` = guest, and that is the
normal case (a registration wall in front of an Indonesian checkout loses the sale). Checkout also
**captures abandoned carts** (migrations 0044/0045, `checkout_sessions`): there is no "abandon" event
to listen for — abandonment is the *absence* of an order — so the row is written **as the shopper
types** (`POST /api/checkout-session`, tenant from the `Host` header, fails quiet), aged
`aktif → ditinggal` after 60 min of silence by an opportunistic sweep (no cron), and flipped to `pulih`
by `/api/public/order` when that session becomes that order. The merchant works the list at
**Pelanggan → Keranjang Ditinggal** and recovers over **WhatsApp** (`wa.me` + a *signed*, store-bound,
7-day `?r=` link — never a raw session id, which would hand anyone who sees the URL a stranger's name,
phone and address).

---

## 8. Product variants (end-to-end)

Schema: `product_options` + `product_variants` (option1/2/3 + sku + priceIdr) + `inventory_levels`
per variant/location.
- **Admin editor** — adaptive **TikTok-Shop/Shopee-style** builder: up to 2 option types (e.g.
  Warna + Ukuran), **chip values** (type+Enter to add), an auto-regenerating **cartesian matrix**
  with per-variant SKU/harga/stok, and a **"Terapkan ke semua"** bulk apply. On save it
  **reconciles by option-combo key** (matched update-in-place keeping stock/history, new insert,
  removed delete only if not referenced by `order_line_items`).
- **Storefront** — one button group per option → resolves the variant → live price + stock indicator.
- **Cart** — variant-aware; keranjang/checkout show "Varian: {combo}".

---

## 9. Integrations

### Shipping — KiriminAja (real courier API)

Platform-managed aggregator (§4). **Full flow, with the diagrams and every guard:
[`FLOWS.md` §5](./FLOWS.md#5-shipping-end-to-end--address-cascade--quote--snapshot--booking--label).
Courier policy: [ADR 0010](../decisions/0010-courier-policy.md).** The summary:

> **🚚 Kecamatan PRICES the parcel. Kelurahan BOOKS it.** `shipping_price` accepts village ids and
> **ignores them** (a nonsense village id returns identical costs) — tariffs are **kecamatan-level**. The
> **kelurahan** is what `request_pickup` books against and what a driver reads on the label.
> **Do not add village ids to the pricing call.**

Sandbox base `https://tdev.kiriminaja.com`, `Authorization: Bearer`; key + `KIRIMINAJA_ORDER_PREFIX` in a
**gitignored** `.env.local`. Client `packages/lib/src/kiriminaja.ts` — **the version prefix varies PER
endpoint**: `shipping_price` **v6.1** · `request_pickup` **v6.1** · `get_address_by_name` **v2** ·
`cancel_shipment` **v3** · `kelurahan` / `province` / `tracking` **unversioned**.

- **The address cascade is kecamatan → kelurahan.** Kota, provinsi and kodepos are **derived** from the
  pick (KiriminAja returns a `postal_code` per village). The shopper types four fields, not nine.
- ⚠️ **The local `kelurahan` table (78.764 rows) uses BPS/Kemendagri codes (`34.02.13.2004`), NOT
  KiriminAja ids (`31483`) — its ids are NOT bookable.** Only ids from the live API can be booked; the
  local table is a name + kodepos fallback (`id: null`) for the ~4% of districts the API has no list for.
- **The ongkir origin is the seller's pickup address** (`store_settings.sender_kecamatan_id` — itself a
  KiriminAja district id). **Never a client-posted city.**
- **The weight is summed from `product_variants.weight_grams`**, server-side. `body.weight` no longer exists.
- **`lib/shipping-quote.ts` is the ONE place a price is produced** — `/api/public/ongkir` quotes the
  checkout and `/api/public/order` **RE-QUOTES** the order before it writes `orders.shipping_idr`. The
  client's `shipping.cost` is not read. A picked service missing from the fresh quote is **rejected**,
  never silently re-couriered.
- **Both quote paths NAME the couriers.** Unfiltered, KiriminAja walks its whole roster: **5.513 ms / 18
  services** vs **512 ms / 14** when the enabled couriers are named. The checkout quotes in **two steps** —
  `scope:"primary"` (the chain SPX → JNE) on first paint, `scope:"all"` only when the shopper opens "Lihat
  kurir lainnya" — through the same function, so the two steps cannot disagree.
- **The order SNAPSHOTS the destination** (`orders.ship_*`, migrations 0042 + 0049) and the shipment is
  booked with **those exact ids**. The old code re-resolved the destination from the free-text city name and
  could book a parcel to the wrong district.
- **Merchant selection is PER SERVICE** (`store_shipping_methods`) — a courier-level list cannot say "JNE
  Reguler but not JNE YES". Rates = **(platform-enabled couriers) ∩ (the seller's picks)**, each carrying the
  **effective** COD flag (KiriminAja capability × platform `codAllowed` × the store's `cod_enabled`).
- **Courier policy (ADR 0010):** a seller may offer only **8** couriers (`SELLER_COURIER_CODES`); **SPX + JNE
  are BASELINE and cannot be switched off** (SPX is the COD rail, JNE the backup); J&T Cargo and TIKI are
  platform-only. ⚠️ **Availability is per PICKUP ORIGIN, not global** — J&T quotes from Jakarta and Yogyakarta
  origins but **never from Gubeng (Surabaya)**. "Enabled" does not mean "the shopper will see it".
- **Booking:** Pesanan → "Buat pengiriman" → `request_pickup` → `orders.awb` (**only a waybill the courier
  actually issued**; NULL is the normal outcome in sandbox) + `ka_order_id` + status `dikirim`. Then "Lacak"
  and "Cetak resi" (100×150 mm label, browser print → PDF; refuses without a real AWB).
- **Instant / same-day (GoSend, Grab) was REMOVED** — expedition couriers only. What remains is a *guard*.
- ⚠️ **`KIRIMINAJA_ENV` defaults to `sandbox`.** The rates are genuine API responses but **not production
  tariffs**; an unset env in production silently talks to the sandbox.
- **Prod-only remaining:** tracking **webhook** (needs a public URL); shipment **payment** flow (KA returns
  `unpaid` + `qr_url`).

### Payments — AutoLaris (real payment gateway) — COMPLETE (checkout)
Single platform-managed PSP = **AutoLaris** (`gateway_provider` enum; VA 6 banks / QRIS / DANA).
Base `https://api-h2h.autolaris.com`, Bearer key in gitignored `.env.local`. Client
`apps/admin/lib/autolaris.ts` (`create_payment`). Flow:
- **Super-admin** → Pengaturan → Gateway Pembayaran: AutoLaris + live **"Test koneksi"**.
- **Storefront checkout** → shopper picks a channel (QRIS/VA/DANA) → **"Bayar"** hits the public proxy
  `apps/admin/app/api/public/pay` → real VA/QRIS/e-wallet bill → the **sukses page shows the payment
  instruction** (VA number, QRIS payload, or e-wallet link). Callback endpoint `.../pay/callback`
  marks the payment paid (public URL → prod). `payments` table records transactions.

> **Brand policy:** provider brands (**KiriminAja** shipping, **AutoLaris** payment) are **hidden from
> the client** (merchant admin + storefront) — they see generic labels ("ongkir real-time",
> "Virtual Account BCA", "dikelola TokoΦ"). Only the **super-admin** (platform) sees the brands.

---

## 10. Deployment topology & scaling

- **Now = local Linux.** Docker Postgres 16 (:5433) + the two Next dev servers + the Astro storefront.
- **Prod target (deferred, ADR 0007/0008):** **self-hosted Postgres on a VPS — NOT Supabase**, behind a
  pooler; the same RLS policies enforce (`tokophi_app` role + `app.store_id` GUC). **Per-client storefront**
  deploys are built individually (ADR 0008). Diagram + full topology: `UML.md` §8.
- **Scaling target = 50–100 clients / 10–30k ad-driven visitors.** Static storefront + edge CDN absorbs
  page views cheaply; the **load-bearing paths are images + live ongkir**. Cloudflare-native plan, in
  priority order **before ads**:
  1. **Images → R2 + Cloudflare Images** (product media; local `public/` would choke at 100k+ img req/day).
  2. **Cache `shipping_price` → Workers KV** (avoid KiriminAja rate-limit under burst). *Local dev of this
     pattern is already in place:* `@tokophi/lib/cache` (in-proc TTL, 10 min) wraps `kaShippingPrice` —
     swap the module for KV/Redis in prod.
  3. **DB connection pooling** (PgBouncer / Hyperdrive) for campaign bursts.
  4. **Queue** (Cloudflare Queues / Inngest) for async: payment callbacks, shipment dispatch, tracking,
     WA/email notifications, abandoned-cart.
- A dedicated backend (Hono/NestJS) + full Redis are **optional** at this scale (the Next full-stack +
  `/api/public/*` proxies cover it). **Open decision:** storefront SSG-rebuild-per-store vs SSR + edge-cache.

---

## 11. Local dev quickstart

```bash
npm install                                   # all workspaces
docker compose up -d db                        # PostgreSQL 16 @ localhost:5433
npm run migrate -w @tokophi/db               # apply migrations 0000–0049
npm run seed    -w @tokophi/db               # demo data (7 stores, fashion variants) — idempotent

npm run dev:admin                              # merchant admin → http://localhost:3000
npm run dev:super                              # super-admin    → http://localhost:3001
cd apps/storefront && npm run dev              # storefront      → http://localhost:4327
```
`DATABASE_URL` + `AUTH_SECRET` + `KIRIMINAJA_*` live in each app's `.env.local` (copy from `.env.example`).
Build: `npm run build:admin` · `npm run build:super` · (storefront) `npm run build`.

---

## 12. Conventions (must-follow)

- **UI = shadcn on Base UI (`@base-ui/react`), NOT Radix:** use the **`render` prop, not `asChild`**;
  there is **no `Select`** primitive; `Button`-as-link needs `nativeButton={false}`. (#1 source of bugs.)
- **Determinism:** all seed/mock data is anchored to a fixed `TODAY`; no `Date.now()`/`Math.random()`
  in render paths (SSR===client).
- **Money** always IDR via `@tokophi/lib`; **nav** via `@tokophi/data`.
- **Indonesian slugs** on the storefront: `/produk/`, `/kategori/`, `/blog/`.
- Keep it **console-clean**; `npm run build` must pass; page `<title>` uses `" - "` not `"|"`.

---

## 13. Current status & what's next

**Do not trust this section over [`STATUS.md`](STATUS.md)** — that is the doc that separates *real* from
*seeded* from *fake*, and it is re-derived from the database. In short: all four surfaces are live on
`tokophi.com`, every admin editor persists, auth + RBAC + RLS enforce, the ledger/payouts/COD gate are real,
and shipping is **kelurahan-precise end to end** (address cascade → server-side quote → order snapshot →
booking with the snapshot ids → label).

**The honest gaps** (each is in `STATUS.md` / `BACKLOG.md` with evidence):
- `KIRIMINAJA_ENV` defaults to **sandbox** — everything downstream of the price is real; the price is not.
- **The SPX-only COD policy rests on an unverified claim** (that a refused SPX parcel returns free).
- `orders.courier` is **NULL on every row** — a checkout books no shipment, so the per-courier COD
  return-rate — the number the COD policy is betting on — **cannot be computed**.
- The courier roster is harvested from **one** reference route (being fixed to a multi-route union).
- The storefront `/blog` is hardcoded — **the merchant's blog editor publishes into a void**.

**Next:** VPS activation (self-hosted Postgres + PostgREST + Storage) — which carries the shipping prod-only
bits (tracking webhook, shipment payment flow).

---

## 14. Doc map

| Doc | What it covers |
|---|---|
| **SYSTEM_GUIDE.md** (this) | whole-system overview |
| **[`FLOWS.md`](FLOWS.md)** | the critical flows as sequence diagrams. **§5 = shipping end to end — the doc to read before touching checkout** |
| [`CODE_MAP.md`](CODE_MAP.md) | the development map: structure, packages, where each concern lives |
| [`STATUS.md`](STATUS.md) | **real vs seeded vs fake**, re-derived from the DB |
| [`../PRD.md`](../PRD.md) | product requirements, scope, the money + COD policy |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | how the surfaces are built, data-layer seam, topology |
| [`GUIDE.md`](GUIDE.md) | contributor setup + how-to recipes |
| [`SCHEMA.md`](SCHEMA.md) / [`DATA_MODEL.md`](DATA_MODEL.md) | database |
| [`UML.md`](UML.md) | detailed diagrams |
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | verifiable statements + how to check each one |
| [`UI_INVENTORY.md`](UI_INVENTORY.md) | screen/component inventory |
| [`CONCEPT.md`](CONCEPT.md) | positioning / vision |
| [`../decisions/`](../decisions/) | ADRs (**0001–0010**; 0010 = courier policy) |
| [`WORKLOG.md`](WORKLOG.md) / [`BACKLOG.md`](BACKLOG.md) | session log / priorities |
