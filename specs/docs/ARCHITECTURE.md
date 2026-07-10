# TokoΦ — Architecture

> Authoritative architecture doc. Companion to [`../PRD.md`](../PRD.md) (product), [`GUIDE.md`](GUIDE.md) (how to build/contribute), [`UML.md`](UML.md) (detailed diagrams), [`SCHEMA.md`](SCHEMA.md) / [`DATA_MODEL.md`](DATA_MODEL.md) (DB). Describes how the three surfaces are built, the shared **local-Postgres backend fully wired behind the data layer** (all three surfaces live on it — ADR 0007), and the **per-client topology** (ADR 0008, **amended by [ADR 0009](../decisions/0009-self-serve-store-builder.md)**: storefront is SSR multi-tenant + self-serve store builder, not per-client hand-built static).

---

## 1. System overview — three surfaces

TokoΦ is a Shopify-style commerce SaaS for Indonesia (Bahasa Indonesia UI, IDR). It has **no** Apps/Plugins marketplace, but **does** have a self-serve, section-based store builder (ADR 0009 — curated sections, not free-form theme code). Three separate front-ends serve three audiences:

| Surface | Package | Stack | Port (dev) | Who uses it |
|---|---|---|---|---|
| **admin** | `@tokophi/admin` | Next.js 16 (App Router, Turbopack), React 19 | `:3000` | A **merchant / shop owner** — manages their own store (orders, products, customers, discounts, CRM, pages, blog, nav, settings, **store builder/theme**). |
| **super-admin** | `@tokophi/super-admin` | Next.js 16 | `:3001` | **We (the platform)** — cross-tenant control plane: all stores, plans, billing. |
| **storefront** | `@tokophi/storefront` | Astro 5 + Tailwind v4 | `:4327` | A **shopper** — one **SSR multi-tenant** storefront (resolves store by `Host`), rendering each store's chosen section templates (browse, cart, checkout, blog, account, contact). |

Started as **UI/UX with mock data**; the **local backend is wired** on PostgreSQL (see §9) — all 3 surfaces read + all 12 admin editors write + local auth/RBAC/RLS enforcing. (`lib/mock/store.ts` now only serves as the deterministic seed-parity source.)

```mermaid
flowchart LR
  Merchant([Merchant]) --> Admin[admin :3000<br/>Next.js on Vercel]
  Platform([Platform team]) --> Super[super-admin :3001<br/>Next.js on Vercel]
  Shopper([Shopper]) --> Store[storefront :4327<br/>Astro on Cloudflare]

  Admin --> Shared[(shared packages<br/>ui / lib / data)]
  Super --> Shared
  Store --> Shared

  Super ==>|live now| PG[(local PostgreSQL 16<br/>@tokophi/db · Drizzle · store_id)]
  Admin ==>|live now| PG
  Store ==>|live now| PG
  PG -. prod target .-> VPS[(self-hosted Postgres<br/>+ PostgREST + Auth + Storage · RLS)]
```

- **One admin app, many stores.** A store switcher in the topbar scopes the UI; every query is scoped by `store_id` (app-layer now, Postgres RLS at self-hosted Postgres). super-admin is the only surface that reads across tenants.
- **One storefront per client**, deployed from one templated Astro codebase (a `STORE_SLUG` per deploy), sharing design tokens + the shared nav source. Not a self-serve theme editor.
- **Backend status:** **super-admin + all 16 admin modules + storefront** are **live on local Postgres** via `@tokophi/db` — reads **and** writes end-to-end (all 12 admin editors persist via `lib/actions/*`; super-admin provisioning/lifecycle/settings/billing; real variants). See §9–10 + ADR 0007/0008.

---

## 2. Monorepo layout (npm workspaces)

Workspaces are declared in the root `package.json` as `apps/*` + `packages/*`.

```
tokophi/
├─ apps/
│  ├─ admin/         @tokophi/admin        Next 16, :3000  — merchant admin
│  ├─ super-admin/   @tokophi/super-admin  Next 16, :3001  — platform control plane
│  └─ storefront/    @tokophi/storefront   Astro 5, :4327  — shopper site
└─ packages/
   ├─ ui/            @tokophi/ui    shadcn-on-Base-UI components + cn + Tailwind tokens
   ├─ lib/           @tokophi/lib   IDR/num/pct/timeAgo formatters (id-ID)
   ├─ data/          @tokophi/data  canonical MAIN_MENU / FOOTER_MENU (shared source of truth)
   └─ db/            @tokophi/db    Drizzle schema + client + versioned migrations (local Postgres; VPS-target)
```

Plus a root **`docker-compose.yml`** (local PostgreSQL 16, port `5433`) — see §9 + ADR 0007.

### The three shared packages

| Package | Exports | Provides | Consumed by |
|---|---|---|---|
| **`@tokophi/ui`** | `./styles.css` (Tailwind v4 tokens), `./lib/utils` (`cn`), `./*` (each component, e.g. `@tokophi/ui/button`) | shadcn/ui primitives built on **Base UI** (`@base-ui/react`), Recharts, lucide, cva | **super-admin** (Tailwind picks the components up via `@source` in its `globals.css`). |
| **`@tokophi/lib`** | `.` (index), `./format` | Money/number formatters: `IDR()`, `num()`, `pct()`, `timeAgo()` | **super-admin** (`@tokophi/lib/format`), **storefront** (`IDR` in Astro pages). |
| **`@tokophi/data`** | `.` (re-exports menu), `./menu` | `MAIN_MENU`, `FOOTER_MENU`, `MenuItem`/`MenuItemType` — the **single source of truth for navigation** | **admin** (menu builder), **storefront** (header/footer nav). |
| **`@tokophi/db`** | `.`, `./schema`, `./client` | Drizzle **schema** (54 tables, snake_case, money=`bigint` IDR), `db` client singleton, inferred types, versioned migrations, seed/reset. **Server-only** (`postgres` in `serverExternalPackages`). | **super-admin** + **admin** (13 modules via `lib/data/*` — live). **storefront** next. |

> **admin is a partial migrant.** admin still keeps its **own** local `components/ui` + `lib` (formatters, utils) — de-duping against `@tokophi/ui`/`@tokophi/lib` is a tracked backlog task. It has, however, already adopted the shared **data** package (`@tokophi/data` is in admin's `transpilePackages`). So today: super-admin + storefront consume ui/lib/data; admin consumes only data (plus its local copies of the rest).

---

## 3. Module resolution

Two different mechanisms, because Next and Astro handle workspace TypeScript sources differently:

- **Next.js apps (admin, super-admin)** import raw `.ts`/`.tsx` from the workspace packages, so those packages must be listed in `transpilePackages` (Next won't transpile `node_modules` by default):
  - `apps/admin/next.config.ts` → `transpilePackages: ["@tokophi/data"]`
  - `apps/super-admin/next.config.ts` → `transpilePackages: ["@tokophi/ui", "@tokophi/lib"]`
- **Astro storefront** resolves the workspace symlink directly — Astro/Vite compiles the package's TypeScript source with no extra config. `apps/storefront/src/data/nav.ts` simply `import`s from `@tokophi/data/menu`.
  - Note: storefront's `package.json` currently declares only `@tokophi/lib` as a dep but still imports `@tokophi/data`; it works because npm workspaces symlink all packages under `node_modules/@tokophi/*`. Add the explicit dep if you ever publish/prune.
- **Tailwind v4** is config-less; each consumer's `globals.css` uses `@source` / `@import` to pull the shared component classes and token layer from `@tokophi/ui`.

---

## 4. The data-layer seam (most important idea)

Screens NEVER import raw storage. They call **`lib/data/*`** functions that today read the mock and tomorrow call an API/DB — **same signatures**, so the swap is mechanical.

```
component ─▶ apps/admin/lib/data/dashboard.ts (getSummary, getSeries, getTopProducts, getChannels, …)
                    │  today:                         later (M3):
                    └▶ apps/admin/lib/mock/store.ts ──▶ swap body → Postgres query / server action / route handler
```

- `lib/mock/store.ts` is the **single source of demo data** for admin (deterministic — see §5).
- `lib/data/*` is a thin selector layer that derives view models (e.g. range resolution, KPI deltas, channel weights) from the mock. Component props stay identical when the body changes.
- Entity list screens currently read some mock arrays directly (`PAGES`, `ORDERS`, `MENUS`, …) for brevity; the M3 pattern is to introduce `getOrders()/getProducts()/…` wrappers and switch imports, keeping props the same.
- The **storefront** has its own equivalent seam: `apps/storefront/src/data/catalog.ts` (the shopper-facing mock) with helper selectors (`bestsellers`, `byCollection`, `findProduct`, `productImages`).

### How M3 swaps bodies
1. Stand up the VPS Postgres; model tables from [`SCHEMA.md`](SCHEMA.md) / [`DATA_MODEL.md`](DATA_MODEL.md); enable RLS keyed on `store_id`.
2. Replace each `lib/data/*` function body with a query (server action / route handler). **Component code unchanged.**
3. Storefront reads published data via a read API or a static build per deploy.

---

## 5. Shared-source pattern (single source of truth)

Beyond the seam, some data must stay **identical across surfaces**. The pattern: put the canonical definition in `@tokophi/data`; each surface derives its own shape from it, so they can never drift.

**Nav is the first shared source.** `packages/data/src/menu.ts` defines `MAIN_MENU` + `FOOTER_MENU` (typed `MenuItem[]`). Both surfaces derive from it:

```mermaid
flowchart TD
  Src["@tokophi/data/menu<br/>MAIN_MENU + FOOTER_MENU"]
  Src -->|toNavItems label to title, href to target| AdminMENUS["admin lib/mock/store.ts<br/>MENUS (menu builder screen)"]
  Src -->|map to NavItem| StoreNav["storefront src/data/nav.ts<br/>MAIN_NAV (Header + Footer)"]
  AdminMENUS --> Navigasi["/navigasi admin screen"]
  StoreNav --> Header["Header.astro / Footer.astro"]
```

- admin's `MENUS` are built via `toNavItems(MAIN_MENU)` (maps `label→title`, `href→target`, recursing children) in `lib/mock/store.ts`.
- storefront's `MAIN_NAV` maps `MAIN_MENU` into `{label, href, children}` (parents with children become dropdown triggers, `href` undefined).
- Edit `packages/data/src/menu.ts` once → both the admin menu builder and the storefront header/footer update on rebuild. (Live "edit in admin UI → storefront" still needs the backend to persist changes; that's M3.)
- **Expandable:** the catalog is the next candidate to promote into `@tokophi/data` (currently duplicated in `apps/storefront/src/data/catalog.ts` vs admin's mock) — tracked in [`TASKS.md`](TASKS.md).

---

## 6. Determinism (why the demo never flickers)

- All admin mock data is generated with a **seeded PRNG (mulberry32)** anchored to a constant **`TODAY = 2026-06-30`**.
- Result: server render === client render → **no hydration mismatch**, and reloads are stable (good for screenshots/demos).
- The only intentional client-only motion (live-visitor ticker) **starts from the SSR value** inside `useEffect`, so first paint matches.
- **Rule:** no `Date.now()` / `Math.random()` in any render path that produces displayed data.

---

## 7. Rendering & UI system

**Admin / super-admin (Next.js 16 App Router):**
- `app/layout.tsx` — root; Geist font, anti-FOUC theme script (applies saved / `prefers-color-scheme` dark before paint), `lang="id"`.
- `app/(admin)/layout.tsx` — server component; renders `<Sidebar/>` + `<Topbar/>` + `<main>` + `<Toaster/>` (sonner).
- Screens are **client components** (`"use client"`) because they hold filter/tab/dialog state and render Recharts. Data selectors are pure and run identically on server + client.
- **UI:** shadcn/ui on **Base UI** (`@base-ui/react`) + Tailwind v4. Tokens in `globals.css` (oklch; indigo `--primary` + chart palette). Base UI's divergence from Radix is the #1 footgun — see [`GUIDE.md` §Conventions](GUIDE.md#conventions) and `apps/admin/CLAUDE.md`.
- Charts use shadcn's `ChartContainer` (wraps Recharts `ResponsiveContainer`); render correctly in real browsers (Playwright) but `chrome --headless --virtual-time-budget` mis-measures them.

**Storefront (Astro 5):**
- ~~Static build (SSG)~~ → **moving to SSR multi-tenant** (ADR 0009 amends this): store resolved from the `Host` header per-request (needed so Store Builder saves show up without a redeploy); `page_templates` fetched live and rendered through the section registry. Cart stays client-side in `localStorage`.
- Tailwind v4 via `@tailwindcss/vite`. Indonesian slugs: `/produk/`, `/kategori/`, `/blog/`, `/halaman/`.

---

## 8. Build & deploy targets

**Build/run** (from repo root; scripts in root `package.json`):
- `npm run dev:admin` / `npm run dev:super` — dev servers on :3000 / :3001.
- `npm run build:admin` / `npm run build:super` — typecheck + lint + build.
- Storefront has no root script yet: `cd apps/storefront && npm run dev|build|preview` (Astro on :4327).

**Deploy (planned):**
- **admin** + **super-admin** → **Vercel** (Next.js).
- **storefront** → ~~Cloudflare Pages/Workers, one deploy per client~~ → per `PROD_PLAN.md` §6: **SSR on the VPS** (direct Postgres access, no per-client deploy), Cloudflare in front for CDN/cache/custom-domain only (ADR 0009).

---

## 9. Backend (in progress) — local Postgres + Drizzle → self-hosted Postgres (VPS)

The backend is fully wired **behind the data-layer seam** (§4). Dev stack = **plain PostgreSQL 16 in Docker + Drizzle** in `@tokophi/db` (ADR 0007); prod target = **self-hosted Postgres** (managed Postgres + Auth + Storage). Payments & shipping stay **platform-managed** (ADR 0004).

**Local dev:**
```bash
docker compose up -d db              # PostgreSQL 16 @ localhost:5433 (persisted)
npm run migrate -w @tokophi/db     # apply versioned migrations
npm run seed    -w @tokophi/db     # (re)load demo data (idempotent)
npm run reset   -w @tokophi/db     # drop public + drizzle schemas (then migrate + seed)
npm run studio  -w @tokophi/db     # Drizzle Studio
```

**Wiring status (per surface):**
| Surface | Data source today | Notes |
|---|---|---|
| **super-admin** | ✅ **PostgreSQL** (`lib/data.ts`, `dynamic="force-dynamic"`) | all 5 pages live; `getStores/getPlatform/getInvoices/…` |
| **admin** | ✅ **all reads on PostgreSQL** | ✅ **all 16 modules** — Produk / Diskon / Pelanggan / Kategori / Pesanan / Halaman / Blog / Inventori / CRM / Pembelian / Segmen / Ulasan / Navigasi / Dashboard / Analitik / Pemasaran — the WHOLE admin reads `lib/data/*` + all 12 editors write via `lib/actions/*` |
| **storefront** | mock (`data/catalog.ts`) | after admin: read by `store_id`/`STORE_SLUG` |

**Path to the VPS (no schema rework):** stand up the VPS Postgres → point `DATABASE_URL` at it → apply the same Drizzle migrations → enable **RLS keyed on `store_id`** (policies written, dormant locally) → wire self-hosted (JWT) Auth (owner/staff via `store_users`) + Storage (media). See [`SCHEMA.md`](SCHEMA.md) for tables, [`UML.md`](UML.md) for diagrams.

---

## 10. Tenancy & provisioning (ADR 0008, amended by ADR 0009)

The topology that keeps many clients **easy to manage**: one control plane, one multi-tenant admin, one multi-tenant storefront, **one shared database**.

| Layer | Instances | Tenancy |
|---|---|---|
| **Super Admin** (`apps/super-admin`) | 1 app, 1 deploy | cross-tenant — create/suspend stores, plans, billing |
| **Client Admin** (`apps/admin`) | **1 app, 1 deploy — multi-tenant** | merchant signs into the *same* admin; session → `store_id`; RLS scopes to their store; includes the **Store Builder** (ADR 0009) |
| **Storefront** (`apps/storefront`) | ~~1 codebase, 1 deploy per client~~ → **1 codebase, 1 deploy — SSR multi-tenant** | resolves `store_id` from `Host`/custom domain per-request; renders that store's `page_templates` live from the shared DB |
| **Database** | **1 shared PostgreSQL** | `store_id` on every tenant row + RLS; super-admin bypasses |

> **"Client Admin A / B" is the same admin app, scoped by `store_id` — not a separate deploy per client.**

**Onboard a client = 3 steps (no new admin, no new DB):**
1. super-admin creates the `account` + `store` (+ owner, plan, default settings/location).
2. Seed starter data / merchant fills it in via their scoped admin.
3. Deploy one storefront with that store's `STORE_SLUG` + custom domain (Cloudflare — "1 client 1 deploy").

**Why:** patch/ship the admin once for everyone; one DB to migrate & back up; super-admin's cross-tenant view is free; storefronts stay independent (branding/domain/deploy) where it matters. **Trade-off:** RLS correctness is critical (defence-in-depth: also scope in `lib/data`); a client needing hard isolation can be promoted to a dedicated DB (ADR 0003 escape hatch).
