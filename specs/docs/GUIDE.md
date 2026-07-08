# TokoΦ — Developer / Contributor Guide

> Practical "how do I…" guide. For the *why* and the big picture read [`ARCHITECTURE.md`](ARCHITECTURE.md); for the product spec see [`../PRD.md`](../PRD.md); for the future DB see [`SCHEMA.md`](SCHEMA.md) / [`DATA_MODEL.md`](DATA_MODEL.md); for diagrams [`UML.md`](UML.md).

TokoΦ is a Shopify-style commerce SaaS for Indonesia: **Bahasa Indonesia UI, IDR.** the **local backend is fully wired** on PostgreSQL (Drizzle, `@tokophi/db`) — all 3 surfaces read + all 12 admin editors write + auth/RBAC/RLS + real product variants. No Themes menu, no Apps/Plugins.

---

## 1. Getting started

### Prerequisites
- Node 20+ and npm (npm **workspaces** — one lockfile at the repo root).
- No database or env vars needed in Phase 1 (everything is mock).

### Install (once, from the repo root)
```bash
cd ~/projects/tokophi
npm install          # installs all workspaces + symlinks @tokophi/* packages
```

### Run each app
```bash
# from the repo root (uses the workspace scripts):
npm run dev:admin    # apps/admin        → http://localhost:3000
npm run dev:super    # apps/super-admin  → http://localhost:3001

# storefront has no root script yet — run it directly:
cd apps/storefront && npm run dev   # Astro → http://localhost:4327
```
Per-app equivalents also work: `cd apps/admin && npm run dev`, etc.

### Build (typecheck + lint + build)
```bash
npm run build:admin
npm run build:super
cd apps/storefront && npm run build   # + npm run preview to serve the static output
```
A change is not "done" until the relevant `build` passes **and** the dev overlay / browser console is clean (0 issues).

---

## 2. Repo tour

```
tokophi/
├─ apps/
│  ├─ admin/         merchant admin (Next 16, :3000)
│  ├─ super-admin/   platform control plane (Next 16, :3001)
│  └─ storefront/    shopper site (Astro 5, :4327)
└─ packages/
   ├─ ui/    @tokophi/ui   shared shadcn-on-Base-UI components + cn + Tailwind tokens
   ├─ lib/   @tokophi/lib  IDR/num/pct/timeAgo formatters
   └─ data/  @tokophi/data canonical MAIN_MENU / FOOTER_MENU (shared nav source)
```

### `apps/admin/`
- `app/(admin)/` — route group. `page.tsx` = Dashboard (`/`). Sections: pesanan, produk(+kategori/inventori/pembelian), pelanggan(+segmen/ulasan), crm, diskon, analitik, pemasaran, halaman(+baru), blog(+baru), navigasi, pengaturan.
- `components/admin/` — shell (`sidebar`, `topbar`, `nav-links`, `brand`) + shared bits (`page-header`, `order-status`, `kpi-card`, `*-chart`, …) + per-screen subfolders.
- `components/ui/` — **local** shadcn primitives (on Base UI). *(De-dup vs `@tokophi/ui` is backlog.)*
- `lib/mock/store.ts` — deterministic seeded fixtures, anchored `TODAY=2026-06-30`. **Single source of demo data.**
- `lib/data/` — thin selectors over the mock (`getSummary/getSeries/…`). **Swap bodies for API later; keep signatures.**
- `lib/format.ts` — local `IDR()/num()/pct()/timeAgo()`. `lib/nav.ts` — admin sidebar `NAV_GROUPS` + `STORES`.
- `CLAUDE.md` / `AGENTS.md` — working agreement + the "this Next 16 has breaking changes, read `node_modules/next/dist/docs/`" note.

### `apps/super-admin/`
- Same Next 16 shape, but consumes shared code: `@tokophi/ui/<component>`, `@tokophi/lib/format`; Tailwind picks up shared components via `@source` in `globals.css`.

### `apps/storefront/`
- `src/pages/` — `index.astro`, `produk/[handle].astro`, `kategori/[handle].astro`, `blog/`, `keranjang.astro`, `checkout.astro`, `checkout/sukses.astro`, `akun.astro`, `kontak.astro`.
- `src/components/` — `Header.astro`, `Footer.astro`, `ProductCard.astro`.
- `src/layouts/Layout.astro`, `src/styles/global.css`.
- `src/data/catalog.ts` — the shopper mock (STORE, COLLECTIONS, 14 PRODUCTS, helpers). `src/data/nav.ts` — `MAIN_NAV` derived from the shared `@tokophi/data` menu.

### `packages/`
- `ui/src/components/ui/*.tsx` (exported as `@tokophi/ui/<name>`), `ui/src/lib/utils.ts` (`cn`), `ui/src/styles/globals.css` (`@tokophi/ui/styles.css`).
- `lib/src/format.ts` (`@tokophi/lib/format`).
- `data/src/menu.ts` (`@tokophi/data/menu`) + `data/src/index.ts` (re-export).

---

## 3. Conventions

### Base UI gotchas (shadcn here runs on `@base-ui/react`, **NOT Radix** — #1 source of mistakes)
- **Triggers use the `render` prop, not `asChild`:** `<DropdownMenuTrigger render={<Button>…</Button>} />` (same for Sheet/Dialog/Tooltip).
- **Do NOT use the `Select` component** (Base UI API differs) — use `DropdownMenu`, `Tabs`, or buttons for pickers/filters.
- **`Button` rendered as a Link/anchor needs `nativeButton={false}`:** `<Button nativeButton={false} render={<Link href=… />}>` — otherwise Base UI logs `console.error` ("expected a native <button>"), shown as "1 Issue" in the dev overlay.
- `DropdownMenuItem` supports `onClick`; can also be `render={<Link/>}`.
- Base UI event props: `onValueChange` (Tabs/Select), `onCheckedChange` (Switch/Checkbox).
- **`Menu.GroupLabel` needs a `<Menu.Group>` parent** or it throws "MenuGroupContext is missing" when the menu opens. `DropdownMenuLabel` is patched to a plain `<div>` (works standalone) — keep it that way.

### Determinism
- Never use `Date.now()` / `Math.random()` in render paths that produce displayed data. All mock data is seeded (mulberry32) + anchored to `TODAY=2026-06-30` so SSR === client (no hydration mismatch).
- Client-only jitter (e.g. live ticker) must **start from the SSR value** inside `useEffect`.

### Money & locale
- Money is **always IDR** via `IDR()`; plain numbers via `num()`; percentages via `pct()`; relative time via `timeAgo()` — all `id-ID`. Tabular figures use the `tabular-nums` class.
- Admin uses its local `lib/format.ts`; super-admin/storefront use `@tokophi/lib/format`.

### Storefront slugs (Indonesian)
`/produk/<handle>`, `/kategori/<handle>`, `/blog/<slug>`, `/halaman/<slug>` — **not** `/products//collections/…`.

### Other
- Add `"use client"` to any admin screen with state/handlers; use `next/link` for navigation.
- **Toasts:** `import { toast } from "sonner"` → `toast.success(...)`. `<Toaster>` is mounted in `app/(admin)/layout.tsx`.
- **Product images (admin):** render via `<ProductThumb src={p.image} emoji={p.emoji} … />` (image with emoji fallback) — don't hardcode emoji tiles. Files in `public/products/<slug>.webp`. Demo niche: women's fashion.
- **Console-clean:** after changes, `build` must pass and the dev overlay must show **0 issues**.
- Design language: modern SaaS, `text-muted-foreground` for secondary text, indigo `--primary`, rounded-xl, soft shadows, responsive, AA contrast.

---

## 4. How-to recipes

### Add an admin screen
1. Create `app/(admin)/<route>/page.tsx` (add `"use client"` if interactive).
2. Add mock to `lib/mock/store.ts` and (optionally) selectors in `lib/data/`.
3. Register it in `lib/nav.ts` (`NAV_GROUPS`).
4. Build + verify console clean + screenshot (Playwright renders charts correctly; `chrome --headless --virtual-time-budget` mis-sizes Recharts).

### Add a product to the mock
- **Storefront:** append to `PRODUCTS` in `apps/storefront/src/data/catalog.ts` with `{handle, name, price, category, categoryHandle, image, description, sizes, …}`. Drop the image at `public/products/<handle>.webp`; the 5-image gallery (`productImages`) expects `<handle>-2.webp … -5.webp`.
- **Admin:** add to the products fixture in `apps/admin/lib/mock/store.ts` (keep it deterministic — no random in module scope beyond the seeded PRNG). Image at `apps/admin/public/products/<slug>.webp`.

### Add / edit a nav menu item (updates BOTH surfaces)
Edit **one file**: `packages/data/src/menu.ts` (`MAIN_MENU` for header, `FOOTER_MENU` for footer). A `MenuItem` is `{ id, label, type, href, children? }` with `type ∈ beranda|koleksi|produk|halaman|blog|url`.
- The admin menu builder (`/navigasi`) derives `MENUS` via `toNavItems()` in `lib/mock/store.ts` (`label→title`, `href→target`).
- The storefront header/footer derive `MAIN_NAV` in `src/data/nav.ts` (parents with `children` become dropdown triggers).
- Rebuild both apps → they stay in sync. (Live admin-UI editing that persists to the storefront is M3 / backend.)

### Add a storefront page or collection
- **Static page:** add `src/pages/<name>.astro` (Indonesian slug). Content-only pages live under `/halaman/`.
- **Collection:** add an entry to `COLLECTIONS` in `catalog.ts` and tag products with its `categoryHandle`; `kategori/[handle].astro` renders it. "Virtual" (non-catalog) collections used only by the nav (e.g. `semua`, `promo-gajian`) are defined **inside** `getStaticPaths` in `kategori/[handle].astro`.

---

## 5. Working with the shared packages

| Edit… | …and who picks it up |
|---|---|
| `packages/ui/src/**` | **super-admin** (via `@tokophi/ui/<component>`). admin has its own copy — mirror the change into `apps/admin/components/ui/` if it must apply there too. |
| `packages/lib/src/format.ts` | **super-admin** + **storefront** (`@tokophi/lib/format`). admin uses its own `lib/format.ts`. |
| `packages/data/src/menu.ts` | **admin** (menu builder) + **storefront** (header/footer). |

- Next apps import package **source** directly, so packages must stay in each app's `transpilePackages` (admin → `@tokophi/data`; super-admin → `@tokophi/ui`, `@tokophi/lib`). Astro resolves the workspace symlink with no config.
- Adding a new export to a package: update the package's `package.json` `exports` map, then import as `@tokophi/<pkg>/<subpath>`.

---

## 6. Storefront specifics

### Cart (localStorage)
- Key: `"cart"`, value is a JSON array of line items:
  ```ts
  { handle: string, name: string, price: number, image: string, size: string, qty: number }
  ```
- Add-to-cart reads product data from the button's `data-*` attributes, dedups by **`handle` + `size`** (increments `qty` if the pair already exists), writes back, then dispatches `window.dispatchEvent(new Event("cart:updated"))` so the header badge updates.
- `keranjang.astro` reads/writes the same key for qty +/- and remove.

### Checkout flow
`keranjang.astro` (cart) → `checkout.astro` (form) → `checkout/sukses.astro` (confirmation). All client-side, no payment integration (payments are platform-managed later — ADR 0004).

### Product gallery
`productImages(product)` returns `[base, base-2, …, base-5]` (5 AI-generated shots). The PDP (`produk/[handle].astro`) renders the main image + thumbnails from it.

### Nav
`Header.astro` + `Footer.astro` consume `MAIN_NAV` (from `src/data/nav.ts`, itself derived from `@tokophi/data`). Edit menus in `packages/data/src/menu.ts`, not here.

---

## 7. Build & verify
- Run the app's `build` — must pass typecheck + lint.
- Open the app in a real browser; the Next dev overlay must show **0 issues** and the console must be clean (Base UI `console.error`s show up as "N Issues").
- **Screenshots:** use **Playwright** (renders Recharts correctly). `chrome --headless --virtual-time-budget` mis-sizes `ResponsiveContainer` charts — don't rely on it.

---

## 8. Troubleshooting

- **Astro `getStaticPaths` "X is not defined":** Astro hoists `getStaticPaths` into its own module scope, so it can't see helpers/consts defined elsewhere in the frontmatter. **Define helper data inside the function** (as `kategori/[handle].astro` does with its `VIRTUAL` map).
- **Storefront dev port isn't :4327 / falls through:** other Astro servers may already hold lower ports on this machine, so `astro dev` increments until it's free (often 4327). Read the URL Astro prints; don't assume 4321.
- **`next dev` wrapper exits immediately:** prefer the stable root scripts (`npm run dev:admin` / `dev:super`) rather than a hand-rolled wrapper; re-run if a watcher dies.
- **Base UI "MenuGroupContext is missing":** a `Menu.GroupLabel` was used without a `<Menu.Group>` parent — wrap it, or use the plain-`<div>` `DropdownMenuLabel`.
- **Hydration mismatch:** something used `Date.now()`/`Math.random()` in a render path — route it through the seeded mock and anchor to `TODAY`.
- **Shared component change not showing in admin:** admin uses its **local** `components/ui` copy, not `@tokophi/ui` — edit both until the de-dup backlog task lands.

---

## Docs map
[`ARCHITECTURE.md`](ARCHITECTURE.md) · [`../PRD.md`](../PRD.md) · [`UML.md`](UML.md) · [`SCHEMA.md`](SCHEMA.md) · [`DATA_MODEL.md`](DATA_MODEL.md) · [`TASKS.md`](TASKS.md) · [`BACKLOG.md`](BACKLOG.md). Working agreement: `apps/admin/CLAUDE.md`.
