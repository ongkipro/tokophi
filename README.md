# Indostore

**Shopify-style commerce SaaS for the Indonesian market.** A shared, modern-SaaS **admin panel** runs many merchant stores; a **super-admin** control plane is what we (the platform) use to manage all stores/plans/billing; each client gets a bespoke **Astro storefront** (hand-built per brand — no theme editor).

> Deliberately **no Themes menu** and **no Apps/Plugins marketplace**. Curated, lightweight, **Bahasa Indonesia** UI tuned for local sellers (WhatsApp, COD, QRIS/e-wallets, local couriers) with modern-SaaS polish. UI/UX-first; the **backend is now being wired** on local PostgreSQL (Drizzle) — super-admin + 16 admin modules read the DB.

Full spec & docs: [`specs/`](specs/) (mirrors `~/Documents/Development/indostore/`) — start with [`specs/PRD.md`](specs/PRD.md), [`specs/docs/ARCHITECTURE.md`](specs/docs/ARCHITECTURE.md), [`specs/docs/GUIDE.md`](specs/docs/GUIDE.md).

## The three surfaces

| Surface | App | Who | Tech | Port |
|---|---|---|---|---|
| **Admin** | `apps/admin` | merchant operators | Next 16 (App Router) + shadcn on Base UI | :3000 |
| **Super Admin** | `apps/super-admin` | the platform (us) | Next 16 + shared UI | :3001 |
| **Storefront** | `apps/storefront` | end shoppers | Astro 5 + Tailwind v4 | :4327 |

Demo storefront = **"Batik Nusantara"** (women's fashion, 14 products × 5 AI-generated images).

## Monorepo layout (npm workspaces)

```
indostore/
  apps/
    admin/         # merchant store admin (:3000)
    super-admin/   # platform control plane (:3001)
    storefront/    # per-client Astro shopper site (:4327)
  packages/
    ui/            # @indostore/ui   — shadcn on Base UI + design tokens
    lib/           # @indostore/lib  — IDR / number formatters
    data/          # @indostore/data — canonical nav (single source of truth)
  specs/           # mirror of the docs (PRD, ARCHITECTURE, GUIDE, UML, ADRs, …)
```

`@indostore/data` holds `MAIN_MENU` / `FOOTER_MENU`, consumed by **both** the admin menu builder and the storefront header — edit once, both stay in sync on rebuild.

## Quickstart

```bash
npm install                          # installs all workspaces

npm run dev:admin                    # merchant admin → http://localhost:3000
npm run dev:super                    # super-admin    → http://localhost:3001
cd apps/storefront && npm run dev    # storefront      → http://localhost:4327
```

Build: `npm run build:admin` · `npm run build:super` · (storefront) `cd apps/storefront && npm run build`.

## Database (local Postgres — `@indostore/db`)

Backend is being wired behind the data layer: **plain PostgreSQL 16 in Docker + Drizzle** (53 tables, single-tenant "Batik Nusantara"; prod target = self-hosted Postgres + PostgREST (VPS) — ADR 0007). **super-admin (all 5) + 16 admin modules + storefront read it live**; only writes (mutations) still mock.

```bash
docker compose up -d db              # PostgreSQL 16 @ localhost:5433 (persisted)
npm run migrate -w @indostore/db     # apply versioned migrations
npm run seed    -w @indostore/db     # (re)load demo data — idempotent
npm run reset   -w @indostore/db     # drop public + drizzle schemas (then migrate + seed)
npm run studio  -w @indostore/db     # Drizzle Studio
```
`DATABASE_URL` in root `.env` (tooling) + each app's `.env.local` (copy from `.env.example`). See `specs/decisions/0007` (stack) + `0008` (per-client topology).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · **shadcn/ui on Base UI (`@base-ui/react`)** · Recharts · lucide-react · date-fns · Astro 5 (storefront) · **Drizzle + PostgreSQL 16** (`@indostore/db`, local via Docker) · (later) self-hosted Auth + Storage + Postgres RLS.

## Key conventions

- **UI = shadcn on Base UI** (`@base-ui/react`), **not Radix**: use the **`render` prop, not `asChild`**; there is **no `Select`** primitive; `Button`-as-link needs `nativeButton={false}`. See [`apps/admin/AGENTS.md`](apps/admin/AGENTS.md).
- **Determinism:** all mock data is seeded (mulberry32) and anchored to `TODAY = 2026-06-30` — SSR===client, stable across reloads.
- **Money** in IDR via `@indostore/lib`; **nav** via `@indostore/data`.
- **Payments & shipping are platform-managed** (ADR 0004): the platform configures gateways (Midtrans/Xendit/Duitku) + COD + Biteship aggregator; merchants only enable methods and pick couriers/services.
- Sales channel = **Toko Online only**; analytics attribution = Meta / TikTok / Google Ads + Organic / Other.
- Keep it **console-clean** (no Base UI warnings) and responsive; `npm run build` must pass.

## Status (2026-07-03) — three surfaces built; backend M3 in progress (super-admin + 16 admin modules live on Postgres)

- **Admin:** Dashboard (KPIs, FB-style date range, charts) · Pesanan (+detail) · Produk (+editor, Kategori/Inventori/Pembelian) · Pelanggan (+detail/Segmen/Ulasan) · CRM (Follow-up WA/Pipeline/Template) · Diskon (+editor) · Analitik · Pemasaran (per-provinsi) · Halaman & Blog (create+edit) · **Navigasi** (drag-and-drop menu builder + up/down + sub-menu) · Pengaturan.
- **Super Admin:** Dashboard (MRR/GMV) · Toko (+detail) · Paket · Analitik · Pengaturan (gateways + Biteship + couriers). **← all 5 pages live on PostgreSQL** via `lib/data.ts`.
- **DB-backed (admin, 16):** Produk · Diskon · Pelanggan · Kategori · Pesanan · Halaman · Blog · Inventori · CRM · Pembelian · Segmen · Ulasan · Navigasi · Dashboard · Analitik · Pemasaran read from PostgreSQL via `lib/data/*` (`force-dynamic`). all admin modules now read PostgreSQL.
- **Storefront:** beranda · kategori (+ virtual "semua"/"promo-gajian") · produk (**5-image gallery**) · keranjang · **checkout → sukses** · akun (mock login) · blog · kontak — localStorage cart, 70 AI product images, nav mirrors the admin menu.

**Next:** self-hosted Postgres/PostgREST backend (M3) → payment/courier integrations + multi-store provisioning (M4). Prioritized in [`specs/docs/BACKLOG.md`](specs/docs/BACKLOG.md); task breakdown in [`specs/docs/TASKS.md`](specs/docs/TASKS.md).
