# Changelog — Indostore

All notable changes to the admin. Dates are absolute. Phase: UI/UX-first (mock data).

## 2026-07-01

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
