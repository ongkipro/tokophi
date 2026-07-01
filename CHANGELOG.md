# Changelog — Indostore

All notable changes to the admin. Dates are absolute. Phase: UI/UX-first (mock data).

## 2026-07-01

### M1.5 — docs refresh + backlog
- Docs brought current (2026-07-02): PRD status/roadmap (+M1.5), README status, CONCEPT, UI_INVENTORY, and a new **BACKLOG.md** (prioritized P0–P3 task board from a full screening). AGENTS: ProductThumb/images/toast/Indonesian-slug conventions.

### M1 — Indonesian collection slug + product added-date filter
- Collection (Kategori) storefront slug is now Bahasa Indonesia: /kategori/ (was /collections/).
- Products carry a deterministic addedTs (date+time added). Product list shows "Ditambahkan <tgl>" on cards and a "Ditambahkan" column (date+time) in the table view, plus a date-range filter (Semua/7/30/90 hari). Helpers dateTimeShort/dateShort in lib/format.

### M1 — CRM (WhatsApp follow-up) + concept docs + channel model
- New CRM module (submenu): Overview, Follow-up WA (wa.me deep links + templates), Pipeline kanban, Template WA.
- Concept matured in docs/: CONCEPT.md, SCHEMA.md (backend-ready, proves Supabase-defer is safe), UI_INVENTORY.md.
- Channel model clarified: sales channel = Toko Online only; analytics attribution = Meta Ads / TikTok Ads / Google Ads / Organic / Other (Dashboard/Analitik "Sumber Penjualan", Pesanan "Sumber").

### M1 — Collection editor + SEO alignment
- Kategori upgraded to Shopify-style Collections: full editor at /produk/kategori/[id] (SSG) + /produk/kategori/baru — Manual/Otomatis type, automated conditions builder (all/any + field/operator/value), product members/preview, image, publish/channels/template, SEO. List rows -> editor; Buat kategori -> full page.
- SEO "Pratinjau mesin pencari" card moved into the main content column (col-span-2) across all 4 editors -> aligned with the content width, not full-width.

### M1 — Shopify-style submenus + province filter
- Sidebar submenus (expandable, auto-open in section): Produk → Kategori / Inventori / Pembelian; Pelanggan → Segmen / Ulasan. 5 new sub-pages (collections, inventory w/ stock stepper, purchase orders, customer segments, review moderation).
- Pemasaran: filter by Indonesian province (rescopes KPIs) + "Performa per Provinsi" table. Mock PROVINCES/AD_PROVINCES.
- Fix: DropdownMenuLabel -> plain <div> (Base UI Menu.GroupLabel threw "MenuGroupContext missing" when opened standalone) — fixes latent error across all dropdowns.

### M1 — Editor refinements
- SEO "Pratinjau mesin pencari" moved from the sidebar to a full-width card **below the content** in Blog/Halaman/Produk editors (Shopify-style; blog card renamed from "SEO").
- Product editor **"Tindakan lainnya" dropdown** (edit mode): Ubah kategori, Perbarui stok/inventori (set/tambah/kurangi + reason, live new stock), Buat pesanan pembelian (Purchase Order: pemasok/jumlah/biaya-unit/ETA + live total), + Duplikat/Arsipkan. Mock dialogs.

### M1 — Produk list UI/UX polish
- Status tabs w/ counts (Semua/Aktif/Draft/Stok Menipis) + clickable stat-card quick-filters; sort dropdown; active filter chips w/ clear.
- Bulk selection (grid hover-checkbox + list checkboxes) with a selection action bar (Jadikan Aktif/Draft, Hapus, Batal) + selected-row highlight.
- Richer grid cards (large image tile, price+stock inline, terjual count, Draft dim/overlay); refined list table (Kategori col, responsive).
- Mock: curated 2 drafts + 2 low-stock for meaningful tabs/badges. Console + build clean.

### M1 — Product editor
- **Full Shopify-style product editor** at `/produk/[id]` (edit, SSG per product via `generateStaticParams`) and `/produk/baru` (new): title + rich-text description, media, pricing (live margin/profit), inventory (SKU/barcode/qty + low-stock hint), variants toggle + builder, shipping, and sidebar (status Aktif/Draft, sales channels, organization/category/vendor/tags, SEO with Google preview + auto-slug). Delete in edit mode.
- Wired the Produk list: product cards + table rows navigate to the editor (stretched-link overlay so the ⋯ actions still work, console-clean); "Tambah Produk" now opens the full `/produk/baru` page (replaced the quick-add dialog). 31 routes; build + tsc + console clean.

### M1 — Marketing & analytics
- **Pemasaran** (new menu, Utama group) — ads + conversion tracking for **Meta / Google / TikTok**:
  - *Ringkasan* — blended spend/revenue/ROAS/conversions + spend-vs-revenue bar chart + channel comparison table (belanja/impresi/klik/CTR/CPC/konversi/pendapatan/ROAS).
  - *Saluran Iklan* — per-channel cards (connection status, ROAS/CPA, top campaigns, connect/manage).
  - *Pelacakan* — pixel/tracking setup (Meta Pixel + Conversions API, Google Tag GA4 + Google Ads conversion, TikTok Pixel + Events API).
- **Analitik expanded** — conversion funnel, sales by region (Indonesian cities), device split + new-vs-returning, and an ad-performance (ROAS) summary linking to Pemasaran.
- Mock added: `AD_CHANNELS`, `FUNNEL`, `REGION_SALES`, `DEVICE_SPLIT`, `NEW_VS_RETURNING`. 14 routes; build + tsc + console clean.

### M1 — Content section ("Toko Online")
- Screened real Shopify content structures via Shopify CLI (`shopify store execute`): `Page`, `Blog`/`Article`, `Menu` + `MenuItemType` enum — used to model the UI faithfully.
- **Halaman** — pages list + Shopify-style two-column editor (content, visibility, template, SEO Google-preview, auto-slug). Routes `/halaman`, `/halaman/baru`.
- **Blog** — posts list (blog tabs, authors, comments) + article editor (content, excerpt, featured image, tags, SEO). Routes `/blog`, `/blog/baru`.
- **Navigasi** — menu builder (Menu Utama/Footer, nested typed items, typed link picker, add/edit/delete in local state). Route `/navigasi`.
- Sidebar regrouped into `NAV_GROUPS` (Utama / Toko Online / Sistem).
- Mock data added: `PAGES`, `BLOG_POSTS` + `BLOG_CATEGORIES`, `MENUS` + `NavItem`/`NavMenu`/`NavItemType`.
- Fix: Base UI `nativeButton={false}` on `Button` rendered as `Link` (removed the dev-overlay "1 Issue" console error). Build + tsc + console all clean (13 routes).

### M1 — Core modules
- **Pesanan** — status tabs + counts, filters, table, detail Sheet (line items + timeline), pagination.
- **Produk** — stat cards, filters, grid/list toggle, product cards, add-product Dialog.
- **Pelanggan** — segment tabs, stat cards, sortable table, profile Sheet.
- **Diskon** — usage progress, status tabs, create-discount Dialog.
- **Analitik** — KPIs + sales trend + category bar chart + channel donut + top products (reuses dashboard components/data layer).
- **Pengaturan** — Tabs: Profil / Pembayaran / Pengiriman / Pajak / Pengguna (Indonesian couriers + e-wallets/QRIS/COD).
- Mock data extended: `CUSTOMERS`, `DISCOUNTS`.

### M0 — Scaffold + Dashboard
- Monorepo skeleton; `admin/` = Next.js 16 (App Router, Turbopack) + Tailwind v4 + shadcn/ui (Base UI) + Recharts + lucide + date-fns. Indigo brand accent.
- Admin shell: grouped sidebar, topbar (store switcher, search, notifications, account, dark-mode toggle), responsive drawer.
- **Dashboard** (flagship): KPI cards + SVG sparklines, Facebook-style date-range switcher (Hari ini/Kemarin/7d/30d/Bulan ini/Bulan lalu + compare-to-previous), sales area chart (current vs prev), live activity feed w/ realtime ticker, recent orders, top products, channel donut, order-status breakdown, monthly target.
- Deterministic seeded mock (`lib/mock/store.ts`, anchored `TODAY=2026-06-30`) + thin data layer (`lib/data/`) + `IDR`/id-ID formatting.

## Unreleased / next
- M2: sample Astro storefront; deepen admin interactions (submitting forms → state, detail pages).
- M3: Supabase backend (auth + DB + RLS `store_id`) replacing the mock data layer.
- M4: payments/couriers integration, multi-store provisioning, storefront deploy pipeline.

## 2026-07-02 — Monorepo + Super Admin
- Restructured to a **monorepo** (npm workspaces): apps/admin + apps/super-admin + packages/ui (shared shadcn/Base UI) + packages/lib (formatters). Both apps build.
- **Super Admin** platform control plane (Dashboard/Toko/Paket & Billing/Analitik/Pengaturan) on the shared design system; 18 mock merchant stores; runs on :3001.
- Docs: AGENTS/README/PRD/BACKLOG updated for the monorepo + 3-surface model.
