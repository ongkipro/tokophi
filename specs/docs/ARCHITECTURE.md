# Indostore — Architecture

> Authoritative architecture doc. Companion to [`../PRD.md`](../PRD.md) (product), [`GUIDE.md`](GUIDE.md) (how to build/contribute), [`UML.md`](UML.md) (detailed diagrams), [`SCHEMA.md`](SCHEMA.md) / [`DATA_MODEL.md`](DATA_MODEL.md) (future DB). Describes how the three surfaces are built today (mock-first) and how they become a real backend later.

---

## 1. System overview — three surfaces

Indostore is a Shopify-style commerce SaaS for Indonesia (Bahasa Indonesia UI, IDR). It is **not** a theme editor and has **no** Apps/Plugins marketplace. Three separate front-ends serve three audiences:

| Surface | Package | Stack | Port (dev) | Who uses it |
|---|---|---|---|---|
| **admin** | `@indostore/admin` | Next.js 16 (App Router, Turbopack), React 19 | `:3000` | A **merchant / shop owner** — manages their own store (orders, products, customers, discounts, CRM, pages, blog, nav, settings). |
| **super-admin** | `@indostore/super-admin` | Next.js 16 | `:3001` | **We (the platform)** — cross-tenant control plane: all stores, plans, billing. |
| **storefront** | `@indostore/storefront` | Astro 5 + Tailwind v4 | `:4327` | A **shopper** — one hand-built static storefront per client (browse, cart, checkout, blog, account, contact). |

Phase 1 is **UI/UX with mock data**; the backend is deferred (see §7).

```mermaid
flowchart LR
  Merchant([Merchant]) --> Admin[admin :3000<br/>Next.js on Vercel]
  Platform([Platform team]) --> Super[super-admin :3001<br/>Next.js on Vercel]
  Shopper([Shopper]) --> Store[storefront :4327<br/>Astro on Cloudflare]

  Admin --> Data[(shared packages<br/>ui / lib / data)]
  Super --> Data
  Store --> Data

  Data -. NOW .-> Mock[mock fixtures<br/>admin lib/mock + storefront catalog]
  Data -. LATER .-> Supabase[(Supabase<br/>Postgres + Auth + Storage<br/>RLS by store_id)]
```

- **One admin app, many stores.** A store switcher in the topbar scopes the UI. Later every query is scoped by `store_id` via Postgres RLS. super-admin is the only surface that reads across tenants.
- **One storefront per client**, hand-built in Astro, sharing design tokens + the shared nav source. Not a self-serve theme editor.

---

## 2. Monorepo layout (npm workspaces)

Workspaces are declared in the root `package.json` as `apps/*` + `packages/*`.

```
indostore/
├─ apps/
│  ├─ admin/         @indostore/admin        Next 16, :3000  — merchant admin
│  ├─ super-admin/   @indostore/super-admin  Next 16, :3001  — platform control plane
│  └─ storefront/    @indostore/storefront   Astro 5, :4327  — shopper site
└─ packages/
   ├─ ui/            @indostore/ui    shadcn-on-Base-UI components + cn + Tailwind tokens
   ├─ lib/           @indostore/lib   IDR/num/pct/timeAgo formatters (id-ID)
   └─ data/          @indostore/data  canonical MAIN_MENU / FOOTER_MENU (shared source of truth)
```

### The three shared packages

| Package | Exports | Provides | Consumed by |
|---|---|---|---|
| **`@indostore/ui`** | `./styles.css` (Tailwind v4 tokens), `./lib/utils` (`cn`), `./*` (each component, e.g. `@indostore/ui/button`) | shadcn/ui primitives built on **Base UI** (`@base-ui/react`), Recharts, lucide, cva | **super-admin** (Tailwind picks the components up via `@source` in its `globals.css`). |
| **`@indostore/lib`** | `.` (index), `./format` | Money/number formatters: `IDR()`, `num()`, `pct()`, `timeAgo()` | **super-admin** (`@indostore/lib/format`), **storefront** (`IDR` in Astro pages). |
| **`@indostore/data`** | `.` (re-exports menu), `./menu` | `MAIN_MENU`, `FOOTER_MENU`, `MenuItem`/`MenuItemType` — the **single source of truth for navigation** | **admin** (menu builder), **storefront** (header/footer nav). |

> **admin is a partial migrant.** admin still keeps its **own** local `components/ui` + `lib` (formatters, utils) — de-duping against `@indostore/ui`/`@indostore/lib` is a tracked backlog task. It has, however, already adopted the shared **data** package (`@indostore/data` is in admin's `transpilePackages`). So today: super-admin + storefront consume ui/lib/data; admin consumes only data (plus its local copies of the rest).

---

## 3. Module resolution

Two different mechanisms, because Next and Astro handle workspace TypeScript sources differently:

- **Next.js apps (admin, super-admin)** import raw `.ts`/`.tsx` from the workspace packages, so those packages must be listed in `transpilePackages` (Next won't transpile `node_modules` by default):
  - `apps/admin/next.config.ts` → `transpilePackages: ["@indostore/data"]`
  - `apps/super-admin/next.config.ts` → `transpilePackages: ["@indostore/ui", "@indostore/lib"]`
- **Astro storefront** resolves the workspace symlink directly — Astro/Vite compiles the package's TypeScript source with no extra config. `apps/storefront/src/data/nav.ts` simply `import`s from `@indostore/data/menu`.
  - Note: storefront's `package.json` currently declares only `@indostore/lib` as a dep but still imports `@indostore/data`; it works because npm workspaces symlink all packages under `node_modules/@indostore/*`. Add the explicit dep if you ever publish/prune.
- **Tailwind v4** is config-less; each consumer's `globals.css` uses `@source` / `@import` to pull the shared component classes and token layer from `@indostore/ui`.

---

## 4. The data-layer seam (most important idea)

Screens NEVER import raw storage. They call **`lib/data/*`** functions that today read the mock and tomorrow call an API/DB — **same signatures**, so the swap is mechanical.

```
component ─▶ apps/admin/lib/data/dashboard.ts (getSummary, getSeries, getTopProducts, getChannels, …)
                    │  today:                         later (M3):
                    └▶ apps/admin/lib/mock/store.ts ──▶ swap body → Supabase query / server action / route handler
```

- `lib/mock/store.ts` is the **single source of demo data** for admin (deterministic — see §5).
- `lib/data/*` is a thin selector layer that derives view models (e.g. range resolution, KPI deltas, channel weights) from the mock. Component props stay identical when the body changes.
- Entity list screens currently read some mock arrays directly (`PAGES`, `ORDERS`, `MENUS`, …) for brevity; the M3 pattern is to introduce `getOrders()/getProducts()/…` wrappers and switch imports, keeping props the same.
- The **storefront** has its own equivalent seam: `apps/storefront/src/data/catalog.ts` (the shopper-facing mock) with helper selectors (`bestsellers`, `byCollection`, `findProduct`, `productImages`).

### How M3 swaps bodies
1. Stand up Supabase; model tables from [`SCHEMA.md`](SCHEMA.md) / [`DATA_MODEL.md`](DATA_MODEL.md); enable RLS keyed on `store_id`.
2. Replace each `lib/data/*` function body with a query (server action / route handler). **Component code unchanged.**
3. Storefront reads published data via a read API or a static build per deploy.

---

## 5. Shared-source pattern (single source of truth)

Beyond the seam, some data must stay **identical across surfaces**. The pattern: put the canonical definition in `@indostore/data`; each surface derives its own shape from it, so they can never drift.

**Nav is the first shared source.** `packages/data/src/menu.ts` defines `MAIN_MENU` + `FOOTER_MENU` (typed `MenuItem[]`). Both surfaces derive from it:

```mermaid
flowchart TD
  Src["@indostore/data/menu<br/>MAIN_MENU + FOOTER_MENU"]
  Src -->|toNavItems label to title, href to target| AdminMENUS["admin lib/mock/store.ts<br/>MENUS (menu builder screen)"]
  Src -->|map to NavItem| StoreNav["storefront src/data/nav.ts<br/>MAIN_NAV (Header + Footer)"]
  AdminMENUS --> Navigasi["/navigasi admin screen"]
  StoreNav --> Header["Header.astro / Footer.astro"]
```

- admin's `MENUS` are built via `toNavItems(MAIN_MENU)` (maps `label→title`, `href→target`, recursing children) in `lib/mock/store.ts`.
- storefront's `MAIN_NAV` maps `MAIN_MENU` into `{label, href, children}` (parents with children become dropdown triggers, `href` undefined).
- Edit `packages/data/src/menu.ts` once → both the admin menu builder and the storefront header/footer update on rebuild. (Live "edit in admin UI → storefront" still needs the backend to persist changes; that's M3.)
- **Expandable:** the catalog is the next candidate to promote into `@indostore/data` (currently duplicated in `apps/storefront/src/data/catalog.ts` vs admin's mock) — tracked in [`TASKS.md`](TASKS.md).

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
- Static build (SSG). Dynamic routes (`produk/[handle]`, `kategori/[handle]`) use `getStaticPaths`. Cart is client-side in `localStorage`.
- Tailwind v4 via `@tailwindcss/vite`. Indonesian slugs: `/produk/`, `/kategori/`, `/blog/`, `/halaman/`.

---

## 8. Build & deploy targets

**Build/run** (from repo root; scripts in root `package.json`):
- `npm run dev:admin` / `npm run dev:super` — dev servers on :3000 / :3001.
- `npm run build:admin` / `npm run build:super` — typecheck + lint + build.
- Storefront has no root script yet: `cd apps/storefront && npm run dev|build|preview` (Astro on :4327).

**Deploy (planned):**
- **admin** + **super-admin** → **Vercel** (Next.js).
- **storefront** → **Cloudflare** Pages/Workers, **one deploy per client** (matches the existing petcue/pixsgo pattern).

---

## 9. Path to backend (M3)

Payments & shipping are **platform-managed** (ADR 0004 in `../decisions/`). The backend is **one Supabase** project:

1. Postgres + Auth + Storage; **RLS keyed on `store_id`** for tenant isolation. super-admin uses platform-level (cross-tenant) access.
2. Auth roles (owner / staff); the store switcher reads the user's stores.
3. Swap each `lib/data/*` body for a query (see §4). Components unchanged.
4. Storefront reads published data via read API or per-deploy static build.

See [`SCHEMA.md`](SCHEMA.md) for the target tables and [`UML.md`](UML.md) for detailed diagrams.
