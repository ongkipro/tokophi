# Indostore — Architecture

> Companion to `../PRD.md`. Describes how the admin is built today (mock-first) and how it becomes a real backend later.

## 1. Big picture

```
                 ┌─────────────────────────── shared ───────────────────────────┐
Merchant ─▶ Next.js admin (Vercel) ──┐                                           │
                                     ├──▶ data layer (lib/data/*) ──▶ [NOW] mock fixtures (lib/mock/store.ts)
Shopper  ─▶ Astro storefront/client ─┘                              └▶ [LATER] Supabase (Postgres + Auth + Storage, RLS by store_id)
```

- **One admin app, many stores.** A store switcher in the topbar scopes the UI. Later, every query is scoped by `store_id` (RLS).
- **One storefront per client**, hand-built in Astro, sharing the design tokens. Not a self-serve theme editor.

## 2. The data-layer seam (most important idea)

Screens NEVER import raw storage. They call **`lib/data/*`** functions that today read the mock and tomorrow call an API/DB — same signatures, so the swap is mechanical.

```
component ─▶ lib/data/dashboard.ts (getSummary, getSeries, getTopProducts, …)
                    │  today:            later:
                    └▶ lib/mock/store.ts  ──▶ supabase / REST / server actions
```

Entity list screens currently import the mock arrays directly (`PAGES`, `ORDERS`, …) for brevity; when the backend lands, introduce `getOrders()/getProducts()/...` wrappers and switch imports. Keep component props identical.

## 3. Determinism (why the demo never flickers)

- All mock data is generated with a **seeded PRNG (mulberry32)** and anchored to a constant **`TODAY = 2026-06-30`**.
- Result: server render === client render → **no hydration mismatch**, and reloads are stable (good for screenshots/demos).
- The only intentional client-only motion (live-visitor ticker) **starts from the SSR value** inside `useEffect`, so first paint matches.
- Rule: no `Date.now()` / `Math.random()` in a render path that produces displayed data.

## 4. Rendering model (Next.js 16 App Router)

- `app/layout.tsx` — root; Geist font, anti-FOUC theme script (applies saved/`prefers-color-scheme` dark before paint), `lang="id"`.
- `app/(admin)/layout.tsx` — server component; renders `<Sidebar/>` + `<Topbar/>` + `<main>`.
- Screens are **client components** (`"use client"`) because they hold filter/tab/dialog state and render Recharts. Data functions are pure and run on both server and client identically.
- Charts use shadcn's `ChartContainer` (wraps Recharts `ResponsiveContainer`) → responsive; render correctly in real browsers (Playwright), but `chrome --headless --virtual-time-budget` mis-measures them.

## 5. UI system

- **shadcn/ui on Base UI (`@base-ui/react`)** + Tailwind v4. Tokens in `app/globals.css` (oklch); indigo `--primary` + chart palette overridden at the file end.
- Base UI differences from Radix are the main footguns — see `AGENTS.md` (`render` prop not `asChild`; no `Select`; `nativeButton={false}` for Button-as-Link).
- Shared components: `PageHeader`, `OrderStatusBadge`, `KpiCard`, `SalesChart`, `ChannelChart`, `TopProducts`, `RecentOrders`, `LiveActivity`, shell (`Sidebar/Topbar/NavLinks/Brand`). Per-screen extras live in `components/admin/<screen>/`.
- Navigation config: `lib/nav.ts` → `NAV_GROUPS` (Utama / Toko Online / Sistem) rendered by `NavLinks` (with group labels).

## 6. Theming
Light + dark via a `.dark` class on `<html>`, toggled in the topbar and persisted to `localStorage`; applied pre-paint by the inline script in the root layout.

## 7. Path to backend (M3)
1. Stand up Supabase; model tables from `DATA_MODEL.md`; enable RLS keyed on `store_id`.
2. Add auth (owner/staff roles) + the store switcher reads the user's stores.
3. Replace each `lib/data/*` body with a query (server action / route handler). Component code unchanged.
4. Storefront reads published data via a read API or a static build per deploy.

## 8. Deploy targets (planned)
- **Admin** → Vercel (Next.js). **Storefront** → Cloudflare Pages/Workers per client (matches the existing petcue/pixsgo pattern).
