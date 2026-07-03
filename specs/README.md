# Indostore — Specs & Docs

**Shopify-style commerce SaaS for Indonesia.** A shared, modern-SaaS Next.js **admin** runs many merchant stores; a Next.js **super-admin** is the platform control plane; each client gets a bespoke **Astro storefront** (hand-built, no theme editor). Bahasa Indonesia UI tuned for local sellers (WhatsApp, COD, QRIS/e-wallets, local couriers). UI/UX-first; the **backend is now being wired** on local PostgreSQL (Drizzle) — super-admin + 13 admin modules read the DB.

- **Code:** `~/projects/indostore` — **monorepo (npm workspaces)**: `apps/*` + `packages/*`
- **Conventions/gotchas for coding:** `~/projects/indostore/AGENTS.md`
- **Changelog:** `~/projects/indostore/CHANGELOG.md`

## The three surfaces

| Surface | App | Who | Tech | Port |
|---|---|---|---|---|
| **Admin** | `apps/admin` | merchant operators | Next 16 (App Router) + shadcn/Base UI | :3000 |
| **Super Admin** | `apps/super-admin` | platform (us) | Next 16 + shared UI | :3001 |
| **Storefront** | `apps/storefront` | end shoppers | Astro 5 + Tailwind v4 | :4327 |

Demo storefront = **"Batik Nusantara"** (women's fashion, 14 products × 5 AI images).

## Monorepo layout

```
indostore/
  apps/
    admin/         # merchant store admin (:3000)
    super-admin/   # platform control plane (:3001)
    storefront/    # per-client Astro shopper site (:4327)
  packages/
    ui/            # @indostore/ui  — shadcn on Base UI + design tokens
    lib/           # @indostore/lib — IDR / number formatters
    data/          # @indostore/data — canonical nav (single source of truth)
```

`@indostore/data` holds `MAIN_MENU` / `FOOTER_MENU` consumed by **both** the admin menu builder and the storefront header — edit once, both stay in sync on rebuild.

## Quickstart

```bash
cd ~/projects/indostore
npm install                     # installs all workspaces

npm run dev:admin               # merchant admin  → http://localhost:3000
npm run dev:super               # super-admin     → http://localhost:3001
cd apps/storefront && npm run dev   # storefront   → http://localhost:4327
```

Build: `npm run build:admin` / `npm run build:super`; storefront `cd apps/storefront && npm run build`.

## Docs in this folder

- **[PRD.md](PRD.md)** — product requirements, current status, roadmap (**v0.4**).
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how it's built: data-layer seam, determinism, nav auto-connect, rendering, UI system, path to backend.
- **[docs/CONCEPT.md](docs/CONCEPT.md)** — mature product concept: vision, personas, full feature map, monetization, why deferring backend is safe.
- **[docs/SCHEMA.md](docs/SCHEMA.md)** — backend-ready Postgres/Supabase schema (tables, RLS, enums) + mock→table map + M3 migration steps.
- **[docs/DATA_MODEL.md](docs/DATA_MODEL.md)** — mock entities → future Supabase tables (Shopify-modeled content).
- **[docs/UI_INVENTORY.md](docs/UI_INVENTORY.md)** — every screen, its status, and what backend work it needs.
- **[docs/TASKS.md](docs/TASKS.md)** — granular prototype task breakdown (Epics, sized, with acceptance criteria).
- **[docs/BACKLOG.md](docs/BACKLOG.md)** — prioritized task board (P0–P3) from a full codebase screening.
- **[docs/UML.md](docs/UML.md)** — Mermaid diagrams: system/components, ER data model, checkout sequence, deployment, roles.
- **decisions/** — ADRs:
  - [0001](decisions/0001-stack-and-mock-first.md) — Stack: Next.js admin + Astro storefront, mock-first.
  - [0002](decisions/0002-shadcn-base-ui.md) — shadcn/ui on Base UI (`render` prop, no `Select`, `nativeButton`).
  - [0003](decisions/0003-scope-and-multitenancy.md) — No Themes/Apps + `store_id` RLS multi-tenancy.
  - [0004](decisions/0004-platform-managed-payments-shipping.md) — Payments/COD/shipping are **platform-managed** (merchant "terima matang").
- **wireframes/** — screenshots of the built admin.

## Key conventions

- **UI = shadcn on Base UI** (`@base-ui/react`): use the **`render` prop, not `asChild`**; there is **no `Select`** primitive.
- **Determinism:** all mock data is seeded (mulberry32) and anchored to `TODAY = 2026-06-30` — no hydration mismatch, stable across reloads.
- **Money:** IDR formatting via `@indostore/lib` (`id-ID`); nav via `@indostore/data`.
- **Payments & shipping are platform-managed** (ADR 0004): the platform configures gateways (Midtrans/Xendit/Duitku) + COD + Biteship aggregator; merchants only enable methods and pick couriers.
- Sales channel = **Toko Online only**; analytics attribution = Meta/TikTok/Google Ads + Organic/Other.

## Status (2026-07-03)

**All three surfaces built as clickable products; backend M3 in progress.** Admin (M0+M1+M1.5): Dashboard, Pesanan (+detail), Produk (+editor, Kategori/Inventori/Pembelian), Pelanggan (+detail/Segmen/Ulasan), CRM, Diskon (+editor), Analitik, Pemasaran, Toko Online (Halaman/Blog with create+edit, Navigasi drag-and-drop menu builder), Pengaturan. Super-admin: Dashboard/Toko/Paket/Analitik/Pengaturan. Storefront: beranda, kategori, produk (5-image gallery), keranjang, checkout (+sukses), akun, blog, kontak — localStorage cart, 70 AI product images.

**Backend (M3):** **local PostgreSQL 16 + Drizzle** (`@indostore/db`, 52 tables, single-tenant "Batik Nusantara") is live — **super-admin (all 5) + 13 admin modules** (Produk/Diskon/Pelanggan/Kategori/Pesanan/Halaman/Blog/Inventori/CRM/Pembelian/Segmen/Ulasan) read the DB via `lib/data/*`. Remaining admin screens (Dashboard/Analitik, Pemasaran) + storefront still mock; mutations don't persist yet. See ADR **0007** (stack) / **0008** (per-client topology).

**Next:** finish admin → DB (Dashboard/Analitik, Pemasaran) → **Supabase** (Auth/Storage/RLS) → payment/courier integrations + provisioning (M4). See **[docs/BACKLOG.md](docs/BACKLOG.md)**.
