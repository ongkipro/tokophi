# Indostore — working agreement (read before coding)

Shopify-style commerce SaaS for Indonesia: **one shared Next.js admin** (multi-store) + **per-client Astro storefronts** (bespoke). **No Themes menu, no Apps/Plugins.** Phase 1 = **UI/UX with mock data** — backend deferred. Bahasa Indonesia UI, IDR. Full spec: `~/Documents/Development/indostore/PRD.md`.

## Run
```bash
cd admin && npm run dev      # http://localhost:3000  (Turbopack)
npm run build                # typecheck + lint + static build (13 routes)
```

## Structure (admin/)
- `app/(admin)/` — route group. `page.tsx` = Dashboard (`/`). Sections: pesanan, produk, pelanggan, diskon, analitik, halaman(+baru), blog(+baru), navigasi, pengaturan.
- `components/admin/` — shell (sidebar, topbar, nav-links, brand) + shared bits (page-header, order-status, kpi-card, *-chart, …) + per-screen subfolders.
- `components/ui/` — shadcn/ui primitives (**on Base UI**).
- `lib/mock/store.ts` — deterministic seeded fixtures, anchored `TODAY=2026-06-30`. **Single source of demo data.**
- `lib/data/` — thin data layer over the mock (`getSummary/getSeries/...`). **Swap these bodies for API later; keep signatures.**
- `lib/format.ts` — `IDR()`, `num()`, `pct()`, `timeAgo()` (id-ID). `lib/nav.ts` — grouped `NAV_GROUPS`.

## ⚠️ shadcn/ui here runs on **Base UI (`@base-ui/react`), NOT Radix** — the #1 source of mistakes:
- **Triggers use the `render` prop, NOT `asChild`:** `<DropdownMenuTrigger render={<Button>…</Button>} />` (same for Sheet/Dialog/Tooltip).
- **Do NOT use the `Select` component** (Base UI API differs) — use `DropdownMenu`, `Tabs`, or buttons for pickers/filters.
- **`Button` rendered AS a Link/anchor needs `nativeButton={false}`:** `<Button nativeButton={false} render={<Link href=… />}>` — otherwise Base UI logs a console.error ("expected a native <button>") shown as "1 Issue" in the dev overlay.
- `DropdownMenuItem` supports `onClick`; can also be `render={<Link/>}`.
- Base UI event props: `onValueChange` (Tabs/Select), `onCheckedChange` (Switch/Checkbox).

## Conventions
- **Determinism:** never use `Date.now()`/`Math.random()` in render paths for data — all mock data is seeded + anchored to `TODAY` so SSR===client (no hydration mismatch). Client-only jitter (e.g. live ticker) must start from the SSR value inside `useEffect`.
- Add `"use client"` to any screen with state/handlers. Use `next/link` for navigation.
- **Money is always IDR** via `IDR()`; numbers via `num()`; tabular figures use `tabular-nums`.
- Reuse `PageHeader`, `OrderStatusBadge`, chart components, and the `lib/data` selectors — don't re-fetch/re-derive ad hoc.
- Design: modern SaaS, `text-muted-foreground` for secondary text, indigo `--primary` accent, rounded-xl, soft shadows, responsive, AA. Keep it **console-clean**.
- After changes: `npm run build` must pass, and the dev-overlay must show **0 issues** (check the browser console).

## Adding a screen
1. Create `app/(admin)/<route>/page.tsx` (client if interactive).
2. Add mock to `lib/mock/store.ts` + (optional) selectors in `lib/data/`.
3. Register it in `lib/nav.ts` (`NAV_GROUPS`).
4. Build + verify console clean + screenshot (Playwright renders charts correctly; `chrome --headless --virtual-time-budget` mis-sizes Recharts).

## Docs
PRD + architecture + data model + decisions live in `~/Documents/Development/indostore/`. Changelog: `CHANGELOG.md`. `admin/AGENTS.md` = the create-next-app "Next 16 has breaking changes" note.
