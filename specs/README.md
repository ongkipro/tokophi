# Indostore — Specs & Docs

Shopify-style commerce SaaS for Indonesia. Shared Next.js admin (multi-store) + per-client Astro storefronts. UI/UX-first with mock data.

- **Code:** `~/projects/indostore` — **monorepo (npm workspaces)**: `apps/admin` (merchant admin, :3000), `apps/super-admin` (platform control plane, :3001), `packages/ui` + `packages/lib` (shared). Run `npm run dev:admin` / `npm run dev:super`.
- **Conventions/gotchas for coding:** `~/projects/indostore/AGENTS.md`
- **Changelog:** `~/projects/indostore/CHANGELOG.md`

## This folder
- **[PRD.md](PRD.md)** — product requirements, current status, roadmap (v0.2).
- **[docs/CONCEPT.md](docs/CONCEPT.md)** — 🆕 mature product concept: vision, personas, full feature map (built/planned), monetization, why deferring backend is safe.
- **[docs/SCHEMA.md](docs/SCHEMA.md)** — 🆕 backend-ready Postgres/Supabase schema (tables, RLS, enums) + mock→table map + M3 migration steps. *The concrete proof that "Supabase nanti" is safe.*
- **[docs/UI_INVENTORY.md](docs/UI_INVENTORY.md)** — every admin screen, its status, and what backend work it needs.
- **[docs/BACKLOG.md](docs/BACKLOG.md)** — prioritized task board (P0–P3) from a full codebase screening.
- **[docs/TASKS.md](docs/TASKS.md)** — 🆕 granular **prototype task breakdown** (Epics 0–6, sized, with acceptance criteria) — the detailed execution plan.
- **[docs/UML.md](docs/UML.md)** — 🆕 Mermaid diagrams: system/components, ER data model, checkout+payment+shipping sequence, deployment, roles.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the admin is built (data-layer seam, determinism, rendering, UI system, path to backend).
- **[docs/DATA_MODEL.md](docs/DATA_MODEL.md)** — mock entities → future Postgres/Supabase tables (Shopify-modeled content).
- **decisions/** — ADRs:
  - [0001](decisions/0001-stack-and-mock-first.md) — Stack: Next.js admin + Astro storefront, mock-first.
  - [0002](decisions/0002-shadcn-base-ui.md) — shadcn/ui on Base UI (render prop, no Select, `nativeButton`).
  - [0003](decisions/0003-scope-and-multitenancy.md) — No Themes/Apps + `store_id` RLS multi-tenancy.
  - [0004](decisions/0004-platform-managed-payments-shipping.md) — 🆕 Payments/COD/shipping are **platform-managed** (merchant "terima matang").
- **wireframes/** — screenshots of the built admin (Dashboard, Pesanan, Produk, Analitik, Pengaturan, Halaman, Navigasi, Blog editor), captured 2026-07-01.

## Status (2026-07-02)
Admin **M0 + M1 + M1.5** done: Dashboard + Pesanan + **Produk ▸ (Kategori/Inventori/Pembelian)** + **Pelanggan ▸ (detail/Segmen/Ulasan)** + **CRM ▸ (Follow-up WA/Pipeline/Template)** + Diskon + Analitik + **Pemasaran** + Toko Online (Halaman/Blog/Navigasi, with create **and edit** routes) + **Pengaturan** (redesigned). ~30 routes, all static/SSG, build + tsc + **console clean**.

Demo is a **fashion store (women's clothing)** with **AI-generated product photos**; product list is a Shopify-style compact table. Sales channel = Toko Online; attribution = Meta/TikTok/Google Ads + Organic/Other.

**Next:** finish the data-layer seam across all screens → sample Astro storefront (M2) → Supabase backend (M3). See **[docs/BACKLOG.md](docs/BACKLOG.md)**.
