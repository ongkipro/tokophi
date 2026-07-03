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

## Status (2026-07-03) — full local stack: 3 surfaces READ + all admin editors WRITE Postgres, local auth + media upload (local Linux dev)

> **Current focus = local Linux.** Everything runs locally: PostgreSQL 16 in Docker (:5433) + the two Next dev servers + the Astro storefront. Prod (self-hosted Postgres + PostgREST on a VPS) is deferred until the local stack is feature-complete.

- **Admin:** Dashboard (KPIs, FB-style date range, charts) · Pesanan (+detail) · Produk (+editor, Kategori/Inventori/Pembelian) · Pelanggan (+detail/Segmen/Ulasan) · CRM (Follow-up WA/Pipeline/Template) · Diskon (+editor) · Analitik · Pemasaran (per-provinsi) · Halaman & Blog (create+edit) · **Navigasi** (drag-and-drop menu builder + up/down + sub-menu) · Pengaturan.
- **Super Admin:** Dashboard (MRR/GMV) · Toko (+detail) · Paket · Analitik · Pengaturan (gateways + Biteship + couriers). **← all 5 pages live on PostgreSQL** via `lib/data.ts`.
- **DB-backed (admin, 16):** Produk · Diskon · Pelanggan · Kategori · Pesanan · Halaman · Blog · Inventori · CRM · Pembelian · Segmen · Ulasan · Navigasi · Dashboard · Analitik · Pemasaran read from PostgreSQL via `lib/data/*` (`force-dynamic`). all admin modules now read PostgreSQL.
- **Storefront:** beranda · kategori (+ virtual "semua"/"promo-gajian") · produk (**5-image gallery**) · keranjang · **checkout → sukses** · akun (mock login) · blog · kontak — reads the **same Postgres catalog** (`src/data/catalog.ts` → `@indostore/db` at build/SSR), localStorage cart, 70 AI product images.
- **Writes — all 12 admin editors persist to Postgres via server actions (`lib/actions/*`):** Produk · Diskon · Halaman · Blog · Kategori (create/edit/delete) · order-status · Inventori-stock · Navigasi · Pelanggan · CRM (follow-up) · Segmen · Pembelian (PO create/receive→stock/cancel).
- **Auth (local):** email/password login (jose JWT httpOnly cookie) against `users`⋈`store_users`; `middleware.ts` protects the admin, topbar shows the user + logout. Owner: `ongki@batiknusantara.id / indostore123`.
- **Media (local):** product editor uploads real images → `public/uploads/` + `product_media` (5MB cap), with per-image delete.

**Next (local Linux):** RBAC (gate by `store_users.role`) + enable Postgres RLS (`store_id`). **Later (prod):** self-hosted Postgres + PostgREST on a VPS + Storage (MinIO/S3) → payments/couriers + multi-store provisioning. Prioritized in [`specs/docs/BACKLOG.md`](specs/docs/BACKLOG.md); task breakdown in [`specs/docs/TASKS.md`](specs/docs/TASKS.md).

## Recent log (newest first)

- **2026-07-03** — **Local media upload**: product editor uploads real images → `public/uploads/` + `product_media` (server action, 5MB cap) + per-image delete.
- **2026-07-03** — **Local admin auth**: email/password login, jose JWT httpOnly session, `middleware.ts` route protection, topbar user + logout (`users.password_hash` scrypt).
- **2026-07-03** — **All 12 admin editors now WRITE Postgres** (added Navigasi, Pelanggan, CRM, Segmen, Pembelian incl. a real line-item PO builder with receive→stock) via `lib/actions/*`.
- **2026-07-03** — Decision: **prod backend = self-hosted Postgres + PostgREST on a VPS (not Supabase)**; all docs reframed. Focus stays **local Linux**.
- **2026-07-03** — **All three surfaces READ Postgres** (storefront `catalog.ts` reads `@indostore/db`); **admin 100% DB-backed** (16 modules); 53 tables.
- **⏸️ Paused here** — resume at **RBAC + local RLS** (see [`specs/docs/WORKLOG.md`](specs/docs/WORKLOG.md) "Next up"). Full history: [`CHANGELOG.md`](CHANGELOG.md).
