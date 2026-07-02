# Indostore — Product Requirements Document (PRD v0.3)

> **Working name:** Indostore (rename trivial) · **Owner:** Paduka Ongki / ongkipro
> **Phase:** UI/UX-first (mock data) — backend deferred · **Updated:** 2026-07-02
> **Code:** `~/projects/indostore` · **Docs:** `~/Documents/Development/indostore`
> **Run:** `cd ~/projects/indostore/admin && npm run dev` → http://localhost:3000

---

## 1. Vision & Positioning

A **Shopify-style commerce platform for the Indonesian market**: one shared, modern-SaaS **admin panel** that runs many merchant stores, and a **per-client Astro storefront** (each client's theme hand-built by AI in the terminal — not a self-serve theme editor).

**Deliberately NOT Shopify:**
- ❌ **No Themes menu** (no in-app theme store/editor). Storefronts are bespoke Astro sites per client.
- ❌ **No Apps / Plugins marketplace.** Feature set is curated in-core.
- ✅ Lightweight, fast, **Bahasa Indonesia** UI tuned to Indonesian sellers (WhatsApp, COD, local couriers, e-wallets/QRIS, payday cycles) — with the polish of a modern SaaS (Linear/Vercel/Shopify-admin quality, not a heavy ERP).

**Three surfaces** (monorepo, npm workspaces — `apps/*` + shared `packages/ui`,`lib`):
| Surface | Who | Tech | Multiplicity |
|---|---|---|---|
| **Super Admin** (`apps/super-admin`, :3001) | **platform = us** | Next.js + shared UI | **1**, manages all stores/plans/billing |
| **Admin** (`apps/admin`, :3000) | merchant operators | Next.js + shadcn/ui | **1 shared app**, multi-store |
| **Storefront** (`apps/storefront`, :dev) ✅ | end shoppers | Astro 5 + Tailwind | **1 per client**, custom look (fashion demo built) |

Super-admin & merchant-admin **share the design system** (`@indostore/ui`) + formatters (`@indostore/lib`). Backend later = one Supabase; super-admin = platform role (cross-tenant), admin = `store_id`-scoped (RLS).

**Payments & shipping are platform-managed (merchant "terima matang")** — ADR 0004. We (platform) set up payment gateways (Midtrans/Xendit/Duitku) + **COD** and connect ONE **shipping aggregator** (Biteship → all couriers). The merchant only **enables which payment methods to accept** and **picks which couriers + services (ekspedisi)** to offer; credentials, resi & tariffs are automatic. Money flow: platform collects → settles/payouts to merchant (fee/margin).

📐 Diagrams: **[docs/UML.md](docs/UML.md)** · 🗂️ Task breakdown: **[docs/TASKS.md](docs/TASKS.md)** · 🧱 Backend schema: **[docs/SCHEMA.md](docs/SCHEMA.md)** · ✅ Priorities: **[docs/BACKLOG.md](docs/BACKLOG.md)**.

---

## 2. Current status (what's built)

**Phase 1 = UI/UX with mock data — the admin is a clickable, coherent product.** All screens read typed mock fixtures through a thin data layer so backend is "just wiring later."

**Admin — DONE (M0 + M1, 2026-07-01):**
- **Shell** — grouped sidebar (Utama / Toko Online / Pengaturan), topbar (store switcher, search ⌘K, notifications, account, **dark-mode toggle**), fully responsive (mobile drawer).
- **Dashboard** ⭐ — KPI cards + SVG sparklines, **Facebook-style date-range switcher** (Hari ini / Kemarin / 7 Hari / 30 Hari / Bulan ini / Bulan lalu + compare-to-previous %), sales area chart (current vs previous), live activity feed (realtime ticker), recent orders, top products, sales-by-channel donut, order-status breakdown, monthly target.
- **Pesanan** — status tabs + counts, search + channel filter, table, detail Sheet (line items + timeline), pagination.
- **Produk** — stat cards, filters, grid/list toggle, clickable product cards/rows → **full Shopify-style product editor** (`/produk/[id]` edit + `/produk/baru` new): title/description, media, pricing (live margin), inventory, variants, shipping + sidebar (status, sales channels, organization, SEO w/ Google preview).
- **Pelanggan** — segment tabs (Baru/Reguler/Loyal/VIP), stat cards, sortable table, profile Sheet.
- **Diskon** — usage Progress bars, status tabs, create-discount Dialog.
- **Analitik** — KPIs + sales trend + category bar chart + channel donut + top products + **conversion funnel, sales-by-region, device/new-vs-returning, ad-performance (ROAS) summary**.
- **Pemasaran** — ads + conversion **tracking** for **Meta / Google / TikTok**: Ringkasan (blended spend/revenue/ROAS + comparison), Saluran Iklan (per-channel connect + campaigns + CPA/ROAS), Pelacakan (Meta Pixel/CAPI, GA4/Google Ads, TikTok Pixel/Events API).
- **Pengaturan** — Tabs: Profil / Pembayaran / Pengiriman / Pajak / Pengguna (Indonesian couriers JNE·J&T·SiCepat·AnterAja·Pos·GoSend·Grab; payments Transfer·QRIS·OVO·GoPay·DANA·COD·VA).
- **Toko Online** section — *modeled on Shopify's real content entities, screened live via Shopify CLI (`shopify store execute`): Page / Blog / Article / Menu + MenuItemType:*
  - **Halaman** — pages list + Shopify-style two-column editor (content, visibility, template, SEO Google-preview + auto-slug).
  - **Blog** — posts list (blog tabs, authors, comments) + article editor (content, excerpt, featured image, tags, SEO).
  - **Navigasi** — menu builder (Menu Utama / Footer, nested typed items, typed link picker, add/edit/delete in local state).

**Admin — added since M1 (2026-07-02):**
- **Produk sub-modules** (sidebar submenu Produk ▸): **Kategori/Koleksi** editor (Manual vs Otomatis + conditions builder, members/preview, image, SEO), **Inventori** (editable stock stepper + date filter), **Pembelian** (Purchase Orders). Product editor gained a "Tindakan lainnya" menu (ubah kategori / perbarui stok / buat PO), added date+time, simpler media + a 1-video slot.
- **Pelanggan ▸** — full **detail page** `/pelanggan/[id]` (stats, order history, activity, address, tags/notes, Kirim WA/email) + Segmen + Ulasan sub-pages.
- **CRM ▸** module — Follow-up WhatsApp worklist (real wa.me deep links + templates), Pipeline kanban, Template WA.
- **Halaman/Blog** — now create **and edit** (prefilled) via `/halaman/[id]`, `/blog/[id]`; **Navigasi** content consistent with the store.
- **Pemasaran** — province filter + "Performa per Provinsi". **Pengaturan** — redesigned settings-nav layout + store summary + Notifikasi.
- **Channel model clarified:** sales channel = **Toko Online only**; analytics attribution = **Meta Ads / TikTok Ads / Google Ads / Organic / Other**.
- **Demo niche = fashion (women's clothing)** with **14 AI-generated product photos** (`public/products/*.webp`, webp-optimized). Product list defaults to a **Shopify-style compact table** with small thumbnails.
- **UX:** SEO preview at content width, **sonner toasts** on save/delete, expandable sidebar submenus, Indonesian storefront slugs.
- **Docs:** `docs/CONCEPT.md`, `docs/SCHEMA.md` (backend-ready), `docs/UI_INVENTORY.md`, `docs/BACKLOG.md`.

**Non-goals (still):** real DB/API, auth backend, payment/courier integrations, multi-tenant provisioning, the storefront. All mocked or deferred. See `docs/BACKLOG.md` for the prioritized task list.

---

## 3. Architecture

```
Shopper ──▶ Astro storefront (per client, CF Pages/Workers) ─┐
                                                              ├─▶ (later) API / Supabase (shared)
Merchant ─▶ Next.js admin (shared, Vercel) ───────────────────┘
```

- **Now:** every screen reads typed mock fixtures (`admin/lib/mock/store.ts`) through a thin data layer (`admin/lib/data/*`). Swapping mock → API is a per-function change; component contracts stay identical.
- **Determinism:** all mock data is seeded (mulberry32) and anchored to a fixed `TODAY = 2026-06-30`, so SSR and client render identically (no hydration mismatch) and the demo is stable across reloads.
- **Later:** Supabase (Postgres + Auth + Storage) as the shared backend; each store = a `store_id` scope with Row-Level Security. Storefronts consume published data via a read API or a static build per deploy.

**Stack (admin):** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · **shadcn/ui on Base UI (`@base-ui/react`)** · Recharts · lucide-react · date-fns. Brand accent = indigo (overridden in `app/globals.css`).

**Repo layout:**
```
indostore/
  admin/                 # Next.js — the shared admin (built first)
    app/(admin)/         # route group: dashboard (/) + 11 module routes
    components/admin/    # shell + screen components (per-screen subfolders)
    components/ui/       # shadcn/ui primitives (Base UI)
    lib/mock/store.ts    # deterministic fixtures (seeded, anchored)
    lib/data/            # thin data layer over the mock (swap for API later)
    lib/format.ts        # IDR + id-ID helpers
    lib/nav.ts           # grouped sidebar config
  storefront/            # Astro sample store (later)
  packages/              # shared design tokens (later)
```

See `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `../decisions/` for detail.

---

## 4. Admin IA (Shopify-core minus Themes/Apps)

Grouped sidebar:
- **Utama:** Dashboard, Pesanan, Produk, Pelanggan, Diskon, Analitik, Pemasaran
- **Toko Online:** Halaman, Blog, Navigasi
- **Sistem:** Pengaturan

Global chrome: store switcher, search (⌘K placeholder), notifications, account, dark mode. Responsive down to cheap-Android widths.

### 4.1 Dashboard analytics (flagship)
- **Date-range switcher (FB-style)** with compare-to-previous deltas on every metric.
- **Realtime feel:** online-visitor ticker + live activity feed (mock now; websockets/polling later).
- KPI cards w/ sparkline + delta; sales/orders over time; top products; channel mix; order-status; monthly target.

---

## 5. Storefront (per client) — next
Astro + Tailwind, shares the design tokens preset. Sections: home (hero, featured, categories), collection, product detail, cart, mock checkout. SEO-first (petcue/pixsgo pattern). Visually distinct per brand, hand-built.

---

## 6. Data model
Mock entities today → tables later. See `docs/DATA_MODEL.md`. Core: `Store, Product, Order(+LineItem/Fulfillment/Payment), Customer, Discount, User` + content: `Page, Blog/Article, Menu(+MenuItem)` + analytics day/hour series. Content types mirror Shopify's Admin API shapes (title/handle/body/isPublished/SEO; Menu handle/title/items[]/MenuItemType).

---

## 7. Design language
Modern SaaS: clean, generous spacing, rounded-xl, soft shadows, restrained palette, one indigo accent, light + dark. Font: Geist. Accessibility AA (console-clean, no Base UI warnings). Fast on low-end devices. Component base: **shadcn/ui (Base UI + Tailwind)** shared by admin & storefront.

---

## 8. Roadmap
- **M0 (DONE 2026-07-01):** repo + PRD + admin shell + Dashboard.
- **M1 (DONE 2026-07-01):** Pesanan, Produk, Pelanggan, Diskon, Analitik, Pengaturan + Toko Online (Halaman, Blog, Navigasi).
- **M1.5 (DONE 2026-07-02):** Produk sub-modules (Kategori/Inventori/Pembelian) + CRM (Follow-up WA/Pipeline/Template) + customer & collection editors + Halaman/Blog edit routes + Pemasaran province filter + Pengaturan redesign + fashion demo with AI product photos + Shopify-style product list. Concept matured in `docs/` (CONCEPT/SCHEMA/UI_INVENTORY/BACKLOG).
- **M2 (next):** (a) complete the **data-layer seam** across all screens (pre-backend, see BACKLOG P0); (b) **sample Astro storefront** (1 brand) reading the same catalog → makes "Lihat di toko" real; (c) remaining P1 functional items (order detail page, variants, real uploads).
- **M3:** Wire **Supabase** (auth + DB + Storage + RLS `store_id`) — replace the mock data-layer bodies function-by-function; forms persist; real image upload + rich-text.
- **M4:** Payments/couriers integration, multi-store provisioning, per-client storefront deploy pipeline, billing/plans.

> Detailed, prioritized tasks live in **`docs/BACKLOG.md`**.

---

## 9. Open questions
- Final product name & brand accent.
- Auth model (email+password vs Google; roles owner/staff/gudang).
- Multi-store: shared DB + `store_id` RLS (leaning) vs DB-per-client.
- Storefront data delivery: static build per deploy vs live read API.
- Rich-text editor choice for Halaman/Blog content (currently mock textarea).

*Living doc. Screens verified visually in `wireframes/`. Change history in `../../projects/indostore` git + `CHANGELOG.md`.*
