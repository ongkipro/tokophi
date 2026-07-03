# Indostore — Product Requirements Document (PRD v0.4)

> **Working name:** Indostore (rename trivial) · **Owner:** Paduka Ongki / ongkipro
> **Phase:** UI/UX-first → **backend M3 in progress** (local PostgreSQL/Drizzle; super-admin + 16 admin modules live) · **Updated:** 2026-07-03
> **Code:** `~/projects/indostore` (monorepo) · **Docs:** `~/Documents/Development/indostore`
> **Run:** `npm i` at root, then `npm run dev:admin` (→ :3000) · `npm run dev:super` (→ :3001) · `cd apps/storefront && npm run dev` (→ :4327)

---

## 1. Vision & Positioning

A **Shopify-style commerce platform for the Indonesian market**: one shared, modern-SaaS **admin panel** that runs many merchant stores, and a **per-client Astro storefront** (each client's theme hand-built by AI in the terminal — not a self-serve theme editor).

**Deliberately NOT Shopify:**
- ❌ **No Themes menu** (no in-app theme store/editor). Storefronts are bespoke Astro sites per client.
- ❌ **No Apps / Plugins marketplace.** Feature set is curated in-core.
- ✅ Lightweight, fast, **Bahasa Indonesia** UI tuned to Indonesian sellers (WhatsApp, COD, local couriers, e-wallets/QRIS, payday cycles) — with the polish of a modern SaaS (Linear/Vercel/Shopify-admin quality, not a heavy ERP).

**Three surfaces** (monorepo, npm workspaces — `apps/*` + shared `packages/*`):
| Surface | Who | Tech | Port | Multiplicity |
|---|---|---|---|---|
| **Super Admin** (`apps/super-admin`) | **platform = us** | Next 16 + shared UI | :3001 | **1**, manages all stores/plans/billing |
| **Admin** (`apps/admin`) | merchant operators | Next 16 + shadcn/Base UI | :3000 | **1 shared app**, multi-store |
| **Storefront** (`apps/storefront`) ✅ | end shoppers | Astro 5 + Tailwind v4 | :4327 | **1 per client** ("Batik Nusantara" demo built) |

Super-admin & merchant-admin **share the design system** (`@indostore/ui`) + formatters (`@indostore/lib`); admin & storefront **share the canonical nav** (`@indostore/data`). Backend later = one Supabase; super-admin = platform role (cross-tenant), admin = `store_id`-scoped (RLS).

**Payments & shipping are platform-managed (merchant "terima matang")** — ADR 0004. We (platform) set up payment gateways (Midtrans/Xendit/Duitku) + **COD** and connect ONE **shipping aggregator** (Biteship → all couriers). The merchant only **enables which payment methods to accept** and **picks which couriers + services (ekspedisi)** to offer; credentials, resi & tariffs are automatic. Money flow: platform collects → settles/payouts to merchant (fee/margin).

📐 Diagrams: **[docs/UML.md](docs/UML.md)** · 🗂️ Task breakdown: **[docs/TASKS.md](docs/TASKS.md)** · 🧱 Backend schema: **[docs/SCHEMA.md](docs/SCHEMA.md)** · ✅ Priorities: **[docs/BACKLOG.md](docs/BACKLOG.md)** · 🏛️ Architecture: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## 2. Current status (what's built)

**All three surfaces are clickable, coherent products; backend M3 in progress.** Every screen reads typed fixtures through a thin data layer so backend is "just wiring." **On local PostgreSQL** (Drizzle via `@indostore/db`, Docker :5433 — ADR 0007): **super-admin (all 5) + 16 admin modules** read the DB via `lib/data/*` (`force-dynamic`); all three surfaces (super-admin + admin + storefront) read it; only writes pending; mutations don't persist yet. Single-tenant "Batik Nusantara" MVP; per-client topology = ADR 0008.

### Admin — merchant store admin (`apps/admin`, :3000) — DONE
- **Shell** — grouped sidebar (Utama / Toko Online / Sistem), topbar (store switcher, search ⌘K, notifications, account, **dark-mode toggle**), fully responsive (mobile drawer).
- **Dashboard** ⭐ — KPI cards + SVG sparklines, **Facebook-style date-range switcher** (Hari ini / Kemarin / 7 Hari / 30 Hari / Bulan ini / Bulan lalu + compare-to-previous %), sales area chart (current vs previous), live activity feed (realtime ticker), recent orders, top products, sales-by-channel donut, order-status breakdown, monthly target.
- **Pesanan** — status tabs + counts, search + channel filter, table, pagination; **full order detail page** (`/pesanan/[id]`) with line items + timeline.
- **Produk** — stat cards, filters, grid/list toggle (Shopify-style compact table default) → **full Shopify-style product editor** (`/produk/[id]` edit + `/produk/baru` new): title/description, **5-image gallery Media** (+ 1 video slot), pricing (live margin), inventory, variants, shipping + sidebar (status, sales channels, organization, SEO w/ Google preview), "Tindakan lainnya" menu (ubah kategori / perbarui stok / buat PO). Sub-modules: **Kategori/Koleksi** editor (Manual vs Otomatis + conditions builder, members/preview, image, SEO), **Inventori** (editable stock stepper + date filter), **Pembelian** (Purchase Orders).
- **Pelanggan** — segment tabs (Baru/Reguler/Loyal/VIP), stat cards, sortable table + **detail page** (`/pelanggan/[id]`: stats, order history, activity, address, tags/notes, Kirim WA/email); **Segmen** + **Ulasan** sub-pages.
- **CRM** — Follow-up WhatsApp worklist (real wa.me deep links + templates), Pipeline kanban, Template WA.
- **Diskon** — usage Progress bars, status tabs + **create/edit editor** (`/diskon/baru`, `/diskon/[id]`).
- **Analitik** — KPIs + sales trend + category bar + channel donut + top products + conversion funnel, sales-by-region, device/new-vs-returning, ad-performance (ROAS) summary.
- **Pemasaran** — ads + conversion tracking for **Meta / Google / TikTok**: Ringkasan (blended spend/revenue/ROAS + comparison), Saluran Iklan (per-channel connect + campaigns + CPA/ROAS), Pelacakan (Meta Pixel/CAPI, GA4/Google Ads, TikTok Pixel/Events API), **province filter + "Performa per Provinsi"**.
- **Toko Online** — modeled on Shopify's real content entities (screened live via Shopify CLI):
  - **Halaman** — pages list + Shopify-style two-column editor with create **and** edit (`/halaman/baru`, `/halaman/[id]`): content, visibility, template, SEO Google-preview + auto-slug.
  - **Blog** — posts list (blog tabs, authors, comments) + article editor create/edit (`/blog/baru`, `/blog/[id]`): content, excerpt, featured image, tags, SEO.
  - **Navigasi** — **menu builder** for Menu Utama / Footer: parent/child (2 levels), typed link picker, **drag-and-drop reorder + ↑/↓ buttons**, "Tambah sub-menu" / "Jadikan sub-menu" / "Naikkan jadi induk", add/edit/delete. Reads/writes against the shared `@indostore/data` menu shape.
- **Pengaturan** — redesigned settings-nav + store summary; Profil / **Pembayaran** / **Pengiriman** / Pajak / Pengguna / Notifikasi. Payments & shipping shown as **platform-managed** (merchant only toggles methods + picks couriers).

### Super Admin — platform control plane (`apps/super-admin`, :3001) — DONE · **LIVE ON POSTGRESQL**
> All 5 pages read the database via server-only `lib/data.ts` (`dynamic="force-dynamic"`); no mock. **Single-tenant MVP** — seeded with one real store (**Batik Nusantara**); metrics computed honestly for one store (ADR 0008 = the multi-tenant target). Verified + live-mutation test.
- **Dashboard** — MRR / GMV / platform metrics, deltas, MRR trend, plan distribution, recent invoices, store status, top stores, activity feed.
- **Toko** — all stores list + **detail** (`/toko/[id]`, real uuid route).
- **Paket** — plans/packages + invoices.
- **Analitik** — cross-tenant GMV per plan / per city + status.
- **Pengaturan** — payment gateways (**Midtrans / Xendit / Duitku + COD**), shipping aggregator (**Biteship**), courier catalog — read from `platform_*` tables; the platform-managed config merchants consume "matang".

### Storefront — shopper site (`apps/storefront`, :4327) — DONE (was "next", now built)
Demo brand **"Batik Nusantara"** — a women's-fashion store.
- **Header** — sticky, active-nav highlight, **Account icon** (WhatsApp removed), **Kategori dropdown** mirroring the admin menu, mobile hamburger drawer.
- **Footer** — informational links + **newsletter**.
- **Pages / flows:**
  - **Beranda** (`/`) — hero, collection cards using real product photos, brand-story band, bestseller grid, values, newsletter.
  - **Kategori** (`/kategori/[handle]`) — includes virtual collections "semua" / "promo-gajian"; eyebrow header + sort dropdown.
  - **Produk** (`/produk/[handle]`) — **5-image gallery** + size selector + **Tambah ke Keranjang** + **Beli Sekarang → checkout**.
  - **Keranjang** (`/keranjang`) — cart backed by **localStorage**.
  - **Checkout** (`/checkout`) — kontak / alamat / pengiriman / pembayaran + sticky order summary → **`/checkout/sukses`**.
  - **Akun** (`/akun`) — mock login.
  - **Blog** (`/blog`), **Kontak** (`/kontak`).
- **Media:** 14 women's-fashion products × **5 AI-generated images each = 70 webp** in `public/products/`.

### Shared packages
- **`@indostore/ui`** — shadcn components on **Base UI** (`@base-ui/react`) + design tokens; consumed by both Next apps.
- **`@indostore/lib`** — formatters (IDR / number, `id-ID`).
- **`@indostore/data`** — canonical `MAIN_MENU` / `FOOTER_MENU`: the **single source of truth for navigation**, consumed by BOTH the admin menu builder (`apps/admin/lib/mock/store.ts`) and the storefront header (`apps/storefront/src/data/nav.ts`). Edit once → both surfaces stay in sync on rebuild.
- **`@indostore/db`** (NEW) — **Drizzle** schema (53 tables, snake_case, money=`bigint` IDR) + `db` client + versioned migrations + seed/reset. Server-only. Backs super-admin today (see ADR 0007). `docker compose up -d db` → `npm run migrate` → `npm run seed`.

**Non-goals (still):** auth backend, payment/courier integrations, live "edit-in-admin → storefront" persistence — mocked/deferred. **No longer a non-goal:** the DB is real (local Postgres) and multi-tenant provisioning is decided (ADR 0008). See `docs/BACKLOG.md`.

---

## 3. Architecture

```
Shopper ──▶ Astro storefront (per client, CF Pages/Workers) ─┐
                                                              ├─▶ (later) API / Supabase (shared)
Merchant ─▶ Next.js admin (shared, Vercel) ───────────────────┤
Platform ─▶ Next.js super-admin (cross-tenant) ───────────────┘
```

- **Now:** every screen reads typed mock fixtures (`apps/admin/lib/mock/store.ts`) through a thin data layer (`apps/admin/lib/data/*`). Swapping mock → API is a per-function change; component contracts stay identical.
- **Determinism:** all mock data is seeded (mulberry32) and anchored to a fixed `TODAY = 2026-06-30`, so SSR and client render identically (no hydration mismatch) and the demo is stable across reloads.
- **Nav auto-connect:** admin menu builder + storefront header both derive from `@indostore/data/menu` — one edit propagates to both on rebuild (live edit-in-UI persistence needs M3 backend). Admin↔storefront product data is aligned 1:1 today via separate catalog mocks; full catalog-share is a backlog item.
- **Later:** Supabase (Postgres + Auth + Storage) as the shared backend; each store = a `store_id` scope with Row-Level Security. Storefronts consume published data via a read API or a static build per deploy.

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · **shadcn/ui on Base UI (`@base-ui/react`)** — `render` prop (not `asChild`), no `Select` · Astro 5 · Recharts · lucide-react · date-fns. Brand accent = indigo. Private GitHub repo `ongkipro/indostore`.

**Repo layout:**
```
indostore/
  apps/
    admin/                 # Next 16 — shared merchant admin (:3000)
      app/(admin)/         # route group: dashboard (/) + module routes + detail/editor subroutes
      components/          # shell + per-screen components; shadcn primitives
      lib/mock/store.ts    # deterministic fixtures (seeded, anchored)
      lib/data/            # thin data layer over the mock (swap for API later)
    super-admin/           # Next 16 — platform control plane (:3001)
      app/(platform)/      # dashboard + toko/paket/analitik/pengaturan
    storefront/            # Astro 5 — per-client shopper site (:4327)
      src/pages/           # beranda, kategori, produk, keranjang, checkout(+sukses), akun, blog, kontak
      src/data/nav.ts      # storefront nav derived from @indostore/data
      public/products/     # 70 AI-generated webp (14 products × 5)
  packages/
    ui/                    # @indostore/ui — shadcn on Base UI + tokens
    lib/                   # @indostore/lib — IDR / number formatters
    data/                  # @indostore/data — canonical MAIN_MENU / FOOTER_MENU
```

See `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `decisions/` for detail.

---

## 4. Admin IA (Shopify-core minus Themes/Apps)

Grouped sidebar:
- **Utama:** Dashboard, Pesanan, Produk (▸ Kategori/Inventori/Pembelian), Pelanggan (▸ Segmen/Ulasan), CRM (▸ Follow-up/Pipeline/Template), Diskon, Analitik, Pemasaran
- **Toko Online:** Halaman, Blog, Navigasi
- **Sistem:** Pengaturan

Global chrome: store switcher, search (⌘K placeholder), notifications, account, dark mode. Responsive down to cheap-Android widths.

### 4.1 Dashboard analytics (flagship)
- **Date-range switcher (FB-style)** with compare-to-previous deltas on every metric.
- **Realtime feel:** online-visitor ticker + live activity feed (mock now; websockets/polling later).
- KPI cards w/ sparkline + delta; sales/orders over time; top products; channel mix; order-status; monthly target.

### 4.2 Channel model
Sales channel = **Toko Online only**; analytics attribution = **Meta Ads / TikTok Ads / Google Ads / Organic / Other**.

---

## 5. Storefront (per client) — BUILT

Astro 5 + Tailwind v4, sharing the `@indostore/data` nav and `@indostore/lib` formatters. Demo = **"Batik Nusantara"** women's fashion, 14 products × 5 AI images. Visually distinct per brand, hand-built (no theme editor). SEO-first (petcue/pixsgo pattern).

**Pages:** beranda · kategori/[handle] (+ virtual "semua"/"promo-gajian", sort) · produk/[handle] (5-image gallery, size, add-to-cart, Beli Sekarang) · keranjang · checkout (kontak/alamat/pengiriman/pembayaran) · checkout/sukses · akun (mock login) · blog · kontak.

**Header:** sticky, active nav, Account icon, Kategori dropdown mirroring the admin menu, mobile drawer. **Footer:** links + newsletter. **Cart:** localStorage.

**Deferred:** live product/content from backend, real checkout/payment, catalog-share with admin, auth (all M3/M4).

---

## 6. Data model

Mock entities today → tables later. See `docs/DATA_MODEL.md` / `docs/SCHEMA.md`. Core: `Store, Product, Order(+LineItem/Fulfillment/Payment), Customer, Discount, User` + content: `Page, Blog/Article, Menu(+MenuItem)` + analytics day/hour series. Content types mirror Shopify's Admin API shapes (title/handle/body/isPublished/SEO; Menu handle/title/items[]/MenuItemType). The `Menu` shape is already the canonical `@indostore/data` type shared across surfaces.

---

## 7. Design language

Modern SaaS: clean, generous spacing, rounded-xl, soft shadows, restrained palette, one indigo accent, light + dark. Font: Geist. Accessibility AA (console-clean, no Base UI warnings). Fast on low-end devices. Component base: **shadcn/ui (Base UI + Tailwind)** shared by admin & super-admin; storefront hand-styled with the same tokens.

---

## 8. Roadmap

- **M0 (DONE 2026-07-01):** repo + PRD + admin shell + Dashboard.
- **M1 (DONE 2026-07-01):** Pesanan, Produk, Pelanggan, Diskon, Analitik, Pengaturan + Toko Online (Halaman, Blog, Navigasi).
- **M1.5 (DONE 2026-07-02):** Produk sub-modules (Kategori/Inventori/Pembelian) + CRM + customer & collection editors + Halaman/Blog edit routes + order detail page + Pemasaran province filter + Pengaturan redesign + fashion demo with AI product photos + Shopify-style product list.
- **M2 — storefront + monorepo (DONE 2026-07-02):** repo restructured to `apps/*` + `packages/*`; **super-admin** control plane; **`@indostore/data`** canonical nav shared by admin + storefront; **Navigasi drag-and-drop** menu builder; **Astro storefront built** — "Batik Nusantara" with beranda, kategori, produk (5-image gallery), keranjang, **checkout (+sukses)**, akun, blog, kontak; localStorage cart; 70 AI product images.
- **M3 — backend (IN PROGRESS):**
  - ✅ **Local PostgreSQL 16 + Drizzle** (`@indostore/db`, ADR 0007): 53 tables, versioned migrations, seed.
  - ✅ **super-admin wired to DB** (`lib/data.ts`) — live, verified parity.
  - 🟡 **admin → DB**: ✅ **all 16 modules** — Produk / Diskon / Pelanggan / Kategori / Pesanan / Halaman / Blog / Inventori / CRM / Pembelian / Segmen / Ulasan / Navigasi / Dashboard / Analitik / Pemasaran (seeded full demo: products/collections/customers/orders/discounts/pages/articles/leads/followups/templates/suppliers+POs/segments/reviews/menus/daily-stats/ad-channels; via `lib/data/*`, `force-dynamic`). Admin fully wired; ⏳ storefront + mutations.
  - ⏳ **storefront → DB**: parameterize by `STORE_SLUG` (ADR 0008), read by `store_id`.
  - ⏳ Mutations persist (save/edit/delete); live "edit-in-admin → storefront".
  - ⏳ **Supabase**: connect for Auth + Storage + RLS (`store_id`), same migrations; image upload + rich-text.
- **M4:** Payments/couriers integration (Midtrans/Xendit/Duitku + Biteship), per-client storefront deploy pipeline, billing/plans.

> Detailed, prioritized tasks live in **`docs/BACKLOG.md`**.

---

## 9. Open questions

- Final product name & brand accent.
- Auth model (email+password vs Google; roles owner/staff/gudang).
- ~~Multi-store: shared DB + `store_id` RLS vs DB-per-client.~~ **Decided:** shared DB + `store_id` (+ RLS at Supabase); one multi-tenant admin; storefront per client — **ADR 0008**.
- Storefront data delivery: static build per deploy vs live read API (leaning per-deploy static with `STORE_SLUG`).
- Rich-text editor choice for Halaman/Blog content (currently mock textarea).
- Catalog-share mechanism: single shared catalog source vs published snapshot per storefront build.

*Living doc. Screens verified visually in `wireframes/`. Change history in `~/projects/indostore` git + `CHANGELOG.md`.*
