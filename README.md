# Indostore

Shopify-style commerce platform for the Indonesian market — a **shared, modern-SaaS admin panel** (multi-store) plus **per-client Astro storefronts** (each hand-built per brand).

> Deliberately **no Themes menu** and **no Apps/Plugins marketplace**. Curated, lightweight, Bahasa Indonesia UI with modern-SaaS polish. UI/UX-first: everything runs on **mock data** so backend is "just wiring later."

Full spec: `~/Documents/Development/indostore/PRD.md`.

## Structure
```
indostore/
  admin/         # Next.js (App Router) + Tailwind + shadcn/ui — the shared admin (build first)
  storefront/    # Astro sample storefront (per-client look) — later
  packages/      # shared design tokens / Tailwind preset — later
```

## Apps
### admin — Next.js
```bash
cd admin && npm run dev     # http://localhost:3000
```
Flagship screen: **Dashboard** — KPI cards, sales charts, live activity, and a Facebook-style date-range switcher (Hari ini / Kemarin / 7 Hari / 30 Hari / custom + compare-to-previous). Data comes from `admin/lib/mock/*` via a thin data layer (`lib/data/*`) so mock→API is a one-file swap.

### storefront — Astro (coming next)
Per-client Astro store wired to the same mock catalog; SEO-first, visually bespoke per brand.

## Stack
Next.js · React · TypeScript · Tailwind CSS · shadcn/ui (Radix) · Recharts · (later) Supabase.

## Status
- [x] Repo + PRD
- [x] Admin shell (sidebar + topbar, dark mode) + **Dashboard** (mock) — analytics, FB-style date range, charts, live feed
- [x] **Pesanan** — status tabs+counts, filters, table, detail sheet, pagination
- [x] **Produk** — stat cards, grid/list toggle, filters, add-product dialog
- [x] **Pelanggan** — segments, stats, sortable table, profile sheet
- [x] **Diskon** — usage progress, status tabs, create dialog
- [x] **Analitik** — KPIs + sales trend + category bar + channel donut + top products
- [x] **Pengaturan** — Profil/Pembayaran/Pengiriman/Pajak/Pengguna (couriers + e-wallets)
- [x] **Toko Online** section (Shopify-modeled, structure screened via Shopify CLI):
  - **Halaman** — pages list + Shopify-style editor (content, visibility, template, SEO preview)
  - **Blog** — posts list + article editor (content, excerpt, image, tags, SEO)
  - **Navigasi** — menu builder (Menu Utama/Footer, nested typed items, add/edit/delete)
- [ ] Sample Astro storefront
- [ ] Supabase backend (replace mock data layer)

Run: `cd admin && npm run dev` → http://localhost:3000 (all 8 routes live).
