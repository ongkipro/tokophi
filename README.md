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
- [ ] Orders / Products / Customers
- [ ] Discounts / Analytics / Settings
- [ ] Sample Astro storefront
- [ ] Supabase backend (replace mock data layer)
