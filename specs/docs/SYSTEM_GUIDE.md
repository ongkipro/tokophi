# TokoΦ — System Guide

> **The one doc to understand the whole system.** What TokoΦ is, how the three surfaces fit
> together, the data/security model, the features, the integrations, and where it runs.
> For hands-on contributor setup see [`GUIDE.md`](GUIDE.md); for the DB see [`SCHEMA.md`](SCHEMA.md);
> for rationale see [`../decisions/`](../decisions/) (ADRs). Status is tracked in
> [`WORKLOG.md`](WORKLOG.md) + [`BACKLOG.md`](BACKLOG.md); changes in [`../../CHANGELOG.md`](../../CHANGELOG.md).

---

## 1. What TokoΦ is

**A Shopify-style commerce SaaS built for the Indonesian market.** A shared, modern-SaaS
**admin panel** runs many merchant stores; a **super-admin** control plane is what the platform
(us) uses to manage every store, plan, and integration; each client gets a bespoke **Astro
storefront**, hand-built per brand (no theme editor).

**Deliberately opinionated — what it is NOT:**
- **No Themes menu.** Storefronts are hand-built per client, not editable by merchants.
- **No Apps/Plugins marketplace.** Curated, lightweight feature set instead of an ecosystem.
- **Merchants never touch payment/courier credentials** — the platform owns them (see §4).

Tuned end-to-end for local sellers: **Bahasa Indonesia UI, IDR (no cents), WhatsApp/COD/QRIS,
local couriers, province-level reach** — with the polish of a modern SaaS (Linear/Vercel/Shopify-admin
quality, not a heavy ERP).

---

## 2. The three surfaces

| Surface | App | Who uses it | Tech | Port |
|---|---|---|---|---|
| **Admin** | `apps/admin` | merchant operators (owner/admin/staff/gudang) | Next 16 (App Router, Turbopack) + shadcn on Base UI | :3000 |
| **Super Admin** | `apps/super-admin` | the platform (us) | Next 16 + shared `@tokophi/ui` | :3001 |
| **Storefront** | `apps/storefront` | end shoppers | Astro 5 + Tailwind v4 (SSG) | :4327 |

Demo storefront = **"Batik Nusantara"** (women's fashion, 14 products with real Warna×Ukuran variants).
The platform seed has **7 stores** total (Batik + 6 demo stores) for the super-admin view.

---

## 3. Architecture at a glance

**Monorepo (npm workspaces):**
```
tokophi/
  apps/       admin/  super-admin/  storefront/
  packages/   ui/ (shadcn on Base UI + tokens)   lib/ (IDR/number formatters)
              data/ (canonical nav — one source for admin builder + storefront header)
              db/ (@tokophi/db — Drizzle schema/client + migrations + seed)
  specs/      PRD, ARCHITECTURE, GUIDE, SCHEMA, ADRs, this guide
```

**Data flow (all three surfaces talk to ONE local Postgres):**
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

**Local PostgreSQL 16 (Docker, port 5433) + Drizzle** (`@tokophi/db`) — **54 tables**, snake_case,
money = `bigint` IDR, versioned migrations `0000–0016`. Source of truth = `packages/db/src/schema.ts`;
annotated reference = [`SCHEMA.md`](SCHEMA.md).

**Row-Level Security (RLS) — enforced at runtime locally** (migration `0012_tenant_rls`):
- `tenant_isolation` policy on all **32 store-scoped tables**: a row is visible when
  `store_id = app_current_store_id()` (a `STABLE` helper reading the `app.store_id` GUC).
- A non-owner Postgres role **`tokophi_app`** carries the policies.
- **The admin routes every query through the restricted role:** reads wrap in
  `withCurrentTenant(db => …)` (reads the session, sets the GUC, `SET LOCAL ROLE tokophi_app`);
  writes wrap in `withTenant(session.storeId, db => …)`. So tenant queries run as `tokophi_app`
  with RLS applied, even though the process connects as owner.
- **Deliberate owner exceptions:** auth (pre-session `store_users` read), super-admin (cross-tenant),
  and the storefront (per-client build). `verify-rls` + `verify-rls-app` prove isolation.
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

### Admin (merchant) — 16 modules, all DB-backed
Dashboard (KPIs, FB-style date range, charts) · **Pesanan** (list + detail with status pipeline +
**Cek Ongkir** live rates) · **Produk** (editor with real variants, + Kategori / Inventori / Pembelian
PO) · **Pelanggan** (+ detail / Segmen / Ulasan / **Keranjang Ditinggal**) · **CRM** (follow-up WA / pipeline / templates) ·
**Diskon** · **Analitik** · **Pemasaran** (per-provinsi, channel ROAS) · **Halaman** & **Blog**
(create+edit) · **Navigasi** (drag-and-drop menu builder) · **Pengaturan**. All 12 editors persist
via server actions; **CSV export** on every Ekspor button; **global search (⌘K)** returns real results.

### Super Admin (platform) — functional control plane
Dashboard (MRR/GMV + platform healthcheck rollup) · **Toko** (list + detail, health column/filter,
provisioning "Tambah toko", **impersonation** "Buka panel admin", suspend/activate, change plan) ·
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

### Shipping — KiriminAja (real courier API) — COMPLETE end-to-end
Platform-managed aggregator (§4). Sandbox base `https://tdev.kiriminaja.com`, `Authorization: Bearer`;
key + `KIRIMINAJA_ORDER_PREFIX` in **gitignored** `.env.local`, never committed. Client
`apps/admin/lib/kiriminaja.ts` — endpoints verified against the Postman collection; **version prefix
varies per endpoint** (`shipping_price`=v6.1, `get_address_by_name`=v2, `province`/`tracking`=unversioned,
`request_pickup`=v6.1). The whole flow is wired + verified E2E:
- **Super-admin** → Pengaturan: aggregator = KiriminAja + live **"Test koneksi"**.
- **Admin** order detail → **"Cek Ongkir"**: live rates (store city + order dest → district IDs → `shipping_price`).
- **Admin** Pengaturan → Pengiriman → **"Alamat Pengirim"** (kecamatan autocomplete, persisted per store).
- **Admin** → **"Buat Pengiriman"** (per rate): `request_pickup` (sender + recipient + item_name/shipping_cost/cod/package_type_id) → saves **AWB/courier** to the order, advances it to **dikirim**.
- **Admin** → **"Lacak"** (polls `/api/mitra/tracking`, syncs the real courier AWB) + **"Cetak resi"** (100×150mm label → print→PDF).
- **Storefront** checkout → **live ongkir** via the public proxy `apps/admin/app/api/public/ongkir` (`op=search`/`op=rates`; key stays server-side; `PUBLIC_ONGKIR_API` env-driven).
- **Prod-only remaining:** tracking **webhook** (needs a public URL); shipment **payment** flow (KA returns `unpaid` + `qr_url`; platform pays via KA Credit/gateway).

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
npm run migrate -w @tokophi/db               # apply migrations 0000–0016
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

**Done (local, verified E2E):** rebrand indostore→TokoΦ · all 3 surfaces read + all 12 admin editors
write · auth + RBAC + RLS enforcing + media upload · super-admin functional control plane · real
product variants end-to-end · CSV export · global search · **KiriminAja shipping complete** (config +
Test koneksi · Cek Ongkir · Alamat Pengirim · Buat Pengiriman → real AWB · Lacak/tracking · Cetak
label PDF · storefront checkout live ongkir).

**Next:** **VPS activation** (self-hosted Postgres + PostgREST + Storage) — carries the shipping
prod-only bits (tracking webhook, shipment payment flow) + making per-client storefront config env-driven.

---

## 14. Doc map

| Doc | What it covers |
|---|---|
| **SYSTEM_GUIDE.md** (this) | whole-system overview |
| [`../PRD.md`](../PRD.md) | product requirements, scope, milestones |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | how the surfaces are built, data-layer seam, topology |
| [`GUIDE.md`](GUIDE.md) | contributor setup + how-to recipes |
| [`SCHEMA.md`](SCHEMA.md) / [`DATA_MODEL.md`](DATA_MODEL.md) | database |
| [`UML.md`](UML.md) | detailed diagrams |
| [`UI_INVENTORY.md`](UI_INVENTORY.md) | screen/component inventory |
| [`CONCEPT.md`](CONCEPT.md) | positioning / vision |
| [`../decisions/`](../decisions/) | ADRs (0001–0008) |
| [`WORKLOG.md`](WORKLOG.md) / [`BACKLOG.md`](BACKLOG.md) | session log / priorities |
