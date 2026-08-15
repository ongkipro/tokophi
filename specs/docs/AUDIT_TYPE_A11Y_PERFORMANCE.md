# TokoΦ — Type Safety, Accessibility & Performance Audit

> **Audit batch:** 5 of N — Type Safety, Accessibility & Performance
> **Scope:** TypeScript type coverage across `apps/*` and `packages/*`; Astro island hydration; CSS/Tailwind v4; ARIA/accessibility compliance; image optimization (`imageSrcSet`); Core Web Vitals (LCP, INP, CLS); memory/query footprint.
> **Method:** static evidence gathering only — `grep`/`glob`/`read` against the repository at `/home/ongki/Projects/tokophi` plus three read-only sub-agent investigations (admin/super-admin Next.js surface, landing Astro surface, `packages/db` query/index surface). No application code was modified. No build, lint, or full test suite was executed.
> **Status:** audit report — findings and directives, not an ADR.

---

## 1. Executive Summary & Domain Scope

TokoΦ is a four-application monorepo: `apps/storefront` and `apps/landing` (Astro, SSR/static respectively) serve shoppers and the marketing site; `apps/admin` (seller-facing) and `apps/super-admin` (platform-operator-facing) are Next.js 15 App Router internal tools built on `packages/ui` (shadcn primitives over `@base-ui/react`). `packages/db` is a single Drizzle/Postgres schema shared by every surface, tenant-isolated by RLS.

**Headline finding: this is an unusually disciplined codebase for the three domains under audit.** TypeScript strictness is universal and actually enforced; the storefront's image, font, and Core Web Vitals engineering is backed by six purpose-built browser-driven regression scripts with measured production numbers in their own comments (e.g. "measured on production: 74 KB + 32 KB wasted," "Lighthouse `uses-responsive-images` scored 0, 461 KiB wasted"); accessibility work in the storefront (focus trapping, `inert`, `aria-expanded`/`aria-current`, WCAG AA contrast fixes with the failing/passing ratios recorded in the CSS itself) is well above the baseline typical of a commerce SaaS of this size.

Against that high bar, the audit still surfaces concrete, provable gaps, concentrated in three places:

1. **The storefront's own performance/accessibility regression suite (`npm run verify -w @tokophi/storefront`) is not wired into CI.** Six browser-driven checks that catch exactly the class of regression this report is about (broken `srcset`, third-party script blocking, duplicate/missing `<h1>`) exist and are well engineered, but `.github/workflows/ci.yml` never invokes them — only `vitest run`, `astro check` (type-level only), `verify-migrations`, and the two RLS verifiers run automatically.
2. **`apps/admin` and `apps/super-admin` have an unbounded-query pattern**: a majority of list-page data helpers (`getOrders`, `getProducts`, `getCustomers`, `getStores`, `getActivity`, `getPayouts`, …) select the entire tenant-scoped (or, in super-admin, platform-wide) table with no `.limit()`, next to a working paginated counter-example (`getOrderList`) that proves the pattern is known but not applied uniformly.
3. **`packages/db/src/schema.ts` has drifted from the database it claims to describe**: two migrations (`0083`, `0085`) added indexes directly via raw SQL to fix live incidents, and neither was mirrored back into the Drizzle schema — so `orders`, `payments`, and several other hot tables read today as unindexed in the source of truth, and a future `drizzle-kit generate` cannot see the indexes that already exist in production.

None of these are exploitable security defects; they are latent performance/regression risks that will surface as data volume and merchant count grow, or the next time someone edits `schema.ts` without knowing what already lives in Postgres.

---

## 2. Current Implementation Analysis & Code Evidence

### 2.1 TypeScript Type Coverage

Every `tsconfig.json` in the repository enables `"strict": true` — nine configs, zero exceptions:

| Location | Base | `strict` |
|---|---|---|
| `apps/admin/tsconfig.json` | plain (Next plugin) | `true` |
| `apps/super-admin/tsconfig.json` | plain (Next plugin) | `true` |
| `apps/storefront/tsconfig.json` | `astro/tsconfigs/strict` | `true` (inherited, stricter than `strict`) |
| `apps/landing/tsconfig.json` | `astro/tsconfigs/strict` | `true` (inherited) |
| `packages/{lib,db,data,sections,ui}/tsconfig.json` | plain | `true` |

`apps/storefront` and `apps/landing` extend `astro/tsconfigs/strict`, which layers `noUncheckedIndexedAccess`-adjacent strictness on top of `strict` — the tightest configuration available in the toolchain, applied to the two customer-facing surfaces.

**`any` usage, measured across the full source tree (excluding `.next/`, `dist/`, `node_modules/`, and `.astro/` generated types):**

| Package/app | Real `any` occurrences in source | Notes |
|---|---|---|
| `apps/admin` | 0 | The 5 raw grep hits are all inside prose comments ("any future code path…", "any type"), not type positions. |
| `apps/super-admin` | 0 | — |
| `apps/storefront` | 2 | `Hero.astro:362` — `(window as any).requestIdleCallback`; `Chat.astro:177` — `x: any` on a parsed `fetch()` JSON payload. |
| `apps/landing` | 0 | Only generated `.astro/content.d.ts` (`Record<string, any>`, framework-emitted) matches. |
| `packages/lib`, `packages/db`, `packages/ui`, `packages/sections`, `packages/data` | 0 | — |

**`@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, measured the same way: zero occurrences anywhere in the hand-written source tree of any app or package.** The 171 raw hits from an unfiltered search are entirely inside `apps/admin/.next/**` generated route-typing scaffolding, which is build output, not source.

**Non-null assertions (`!`)**: 2 total in the entire codebase outside generated output — `apps/admin/lib/domain-servable.ts:52` (`chain[0]!`, immediately following a length check that guarantees the index exists) and `apps/storefront/src/middleware.ts:34` (`.replace(...)[c]!`, inside a lookup table indexed by the same character class the regex just matched). Both are locally provable, not defensive-coding shortcuts.

**Assessment:** type coverage is effectively complete and disciplined project-wide. This is not a domain requiring remediation; see §5.1 for the two remaining `any` sites and a hardening note on `tsc --noEmit` CI coverage (Next.js apps only — Astro apps rely on `astro check`, which is itself the app-level type gate; see §4).

### 2.2 Astro Island Hydration

- **`apps/storefront` ships zero React and zero `.tsx` files** (`find apps/storefront -name "*.tsx"` → 0 results; no `@astrojs/react` integration in `astro.config.mjs`). Every interactive behavior (mega-menu, mobile drawer, cart badge, search palette, hero carousel) is hand-written vanilla `<script>` inside `.astro` components. This is the strongest possible posture for INP/TBT — there is no hydration cost anywhere on the storefront, by construction.
- **`apps/landing` hydrates exactly one component**, `MobileNav.tsx`, via `client:load` in `apps/landing/src/components/SiteHeader.astro:49`:
  ```astro
  <MobileNav
    client:load
    routes={MARKETING_ROUTES}
    {currentPath}
    {loginUrl}
  ```
  `MobileNav` renders a `@tokophi/ui` `Sheet` (a `@base-ui/react`-backed hamburger drawer) that is not interacted with until a shopper taps the trigger. `client:load` forces its React + Radix-equivalent bundle to hydrate immediately on every page load, on every viewport, including desktop widths where the trigger is not even visible. `client:idle` or `client:visible` would defer that JS without any CLS/FOUC risk, because the trigger button itself is part of `MobileNav`'s own SSR output (the server-rendered markup already paints; only the event listeners are deferred). No other `client:*` directive exists anywhere in `apps/landing/src` (confirmed by a full-tree grep) — `FeatureIconGrid.tsx` is imported with no directive at all and is fully static.
- `packages/sections` (the section-type registry consumed by both the Puck editor and the storefront renderer) contains zero components and zero hydration directives — it is a types-only package (`registry.ts`), which is expected and not a gap.

### 2.3 CSS / Tailwind v4

All four apps are on Tailwind v4's CSS-first configuration (`@import "tailwindcss"` + `@theme`/`@theme inline` blocks, no `tailwind.config.js` anywhere in the repo):

- **`apps/storefront/src/styles/global.css`** is the most mature of the four. It documents, in-line, a full WCAG AA contrast remediation: the old `--color-muted: #8a7f82` measured 3.59:1 / 3.86:1 / 3.53:1 against the shop's three backgrounds (cream/white/brand-50) — all three fail the 4.5:1 AA text threshold — and the comment records that this single token caused "182 of the 182 contrast violations in the storefront." The replacement `#736669` is documented as 5.09:1 / 5.48:1 / 5.01:1, and a near-miss candidate (`#7a6f72`, 4.50:1 on cream but 4.42:1 on `brand-50`) is explicitly rejected in the same comment as "NOT enough." This is contrast work done and verified, not assumed.
  - The same file also fixes an iOS Safari auto-zoom bug by forcing 16px on touch inputs (`@media (pointer: coarse)`), gates `scroll-behavior: smooth` behind `prefers-reduced-motion: no-preference` (WCAG 2.3.3), and self-hosts Inter + four merchant-selectable display fonts as subsetted (`latin`+`latin-ext` only) `woff2` `@font-face` rules with `font-display: swap`, replacing a `fonts.googleapis.com` `<link>` that the file's own comment measured as "render-blocking for 1.409 ms" in front of an LCP `<h1>` that was "82% render delay."
- **`apps/admin/app/globals.css` and `apps/super-admin/app/globals.css`** use the shadcn default `oklch` token set plus a brand indigo override (`--primary: oklch(0.515 0.23 277)`), with a `.dark` block. `apps/admin` additionally imports the storefront's default brand palette (`@theme { --color-brand-*, --color-ink, --color-cream, ... }`) so that Store Builder/Puck section previews render in the merchant's palette rather than the admin's stone theme — a deliberate, commented design choice, not drift.
- **`apps/landing/src/styles/global.css`** implements dark mode purely via `@media (prefers-color-scheme: dark)` (no JS theme toggle, so zero CLS/INP cost from theme switching) and documents one contrast ratio (`--color-primary-ink` at 6.4:1 on canvas) but — unlike the storefront — has no systematic AA verification comment for the rest of its dark-mode token pairs (muted text, hairline borders). See §5.2.
- `@source` directives are used correctly and narrowly: `apps/landing/src/styles/global.css` scopes its Tailwind content scan to exactly four `packages/ui` component files it actually reuses (`button.tsx`, `sheet.tsx`, `card.tsx`, `badge.tsx`), avoiding an unnecessarily wide utility-class scan.

### 2.4 ARIA / Accessibility Compliance

Aggregate `aria-*` attribute and `sr-only` usage by surface (excluding build output):

| Surface | `aria-*` attributes | `sr-only` usage |
|---|---|---|
| `apps/storefront/src` | 234 | 16 |
| `apps/admin` | 169 | 11 |
| `packages/ui/src` | 50 | 3 |
| `apps/landing/src` | 43 | 0 |
| `apps/super-admin` | 10 | 1 |
| `packages/sections/src` | 0 | 0 (types-only package — not a gap) |

**Storefront (`apps/storefront/src/components/Header.astro`)** is the strongest example in the repo: the mobile drawer is a real `role="dialog"` `aria-modal="true"` with `inert` toggled on the off-screen panel and focus returned to the trigger on close; every disclosure control (`aria-expanded`) is a real `<button>`, never a hover-only affordance; active nav links carry `aria-current="page"`; the cart-count badge deliberately has **no** `aria-label` on the parent link — the comment explains that an `aria-label="Keranjang"` next to visible text "Keranjang 0" previously scored 0 on axe's `label-content-name-mismatch` rule, so the accessible name is instead composed from a plain `sr-only` "Keranjang" + a separate `sr-only` "item" unit around the live digit.

**`packages/ui`'s five interactive primitives (`dialog.tsx`, `select.tsx`, `dropdown-menu.tsx`, `sheet.tsx`, `tabs.tsx`) all wrap `@base-ui/react`** (not hand-rolled), inheriting its focus-trap, keyboard (Escape/Tab/arrow-key), and ARIA-role handling — this is the correct baseline decision and both Next.js apps inherit it for free.

**`apps/admin`'s Puck theme builder has a documented, deliberate accessibility patch**: `apps/admin/lib/theme/puck-a11y.tsx` (78 lines) records a manual accessible-name audit of the `/tema/[id]` canvas — "41 controls, exactly 2 nameless" — and patches only those two (Puck's zoom-level `<select>` and the array-field "add item" `<button>`) via `setAttribute('aria-label', …)` inside a `MutationObserver`, because Puck's own `overrides` API exposes no hook for either control. A dev-only `console.warn` fires if the target selectors stop matching, so the patch itself is regression-guarded. No equivalent coverage exists for Puck's drag-and-drop **reordering** interaction — only the two named controls are addressed, and the repo's own code has no way to verify or extend keyboard-reorder support beyond what `@measured/puck` provides natively.

**Gaps found, all in `apps/admin`/`apps/super-admin`:**

- **Validation-error wiring is incomplete.** `packages/ui/src/components/ui/input.tsx:12` and `textarea.tsx:10` already ship Tailwind variants keyed off `aria-invalid` (`aria-invalid:border-destructive aria-invalid:ring-3`), but a full-tree grep for `aria-invalid={` and `aria-describedby=` actually being *set* in JSX across both Next.js apps returns **zero matches**. Neither app uses `react-hook-form` (also zero matches) — every form is `useState`-driven with `<Label htmlFor>`/`<Input id>` correctly paired (confirmed present in dozens of call sites, e.g. `apps/admin/app/(admin)/akun/keamanan/security-client.tsx:63-72`), but no field ever tells assistive technology that it is currently invalid or why. The CSS hook exists; the state wiring to trigger it does not.
- **No data table in either app exposes `<caption>` or `aria-sort`.** `packages/ui/src/components/ui/table.tsx:98-103` exports a `TableCaption` primitive, but grep finds zero call sites for it across both apps. Sorting (checked at `apps/admin/app/(admin)/produk/produk-client.tsx:326-328`) is implemented as a `<DropdownMenuItem onClick>` menu rather than clickable `<TableHead>` columns, so `aria-sort` is structurally inapplicable to the pattern used — this is a design choice, not an oversight, but it means no admin table currently gives screen-reader users an accessible summary of its own purpose (`<caption>`) or current sort state.
- **`apps/landing` has no skip-link / "skip to content" mechanism** (`apps/landing/src/layouts/Base.astro` — zero matches for `skip-link`/`skip-to-content` anywhere in `src/`), meaning keyboard and screen-reader users must tab through the full header (wordmark, desktop nav, two action links, mobile-nav trigger) on every page before reaching `<main>`. `apps/storefront` and `apps/admin` were not confirmed to have one either (not found in the same searches); this is a repo-wide gap, not landing-specific.

### 2.5 Image Optimization (`imageSrcSet`)

The storefront's `imageSrcSet` system (`apps/storefront/src/data/catalog.ts`) is the single best-engineered subsystem found in this audit. It is backed by a **statically generated, disk-verified width manifest** (`apps/storefront/src/data/static-image-widths.ts`, produced by `scripts/gen-image-widths.mjs`) that reads the *real* intrinsic pixel width of every seeded catalog image off disk rather than trusting a hand-maintained constant — the generator's own header explains this replaced a per-directory constant that mislabeled 14 of 70 `/products/` sources as `800w` when they were actually 600×600, a 33% over-claim that made every product-card `srcset` lie about its own candidates.

Every image consumer that calls `imageSrcSet()` derives its `sizes` attribute from its own real Tailwind layout, not a guess, and — critically — **every caller ties `sizes` presence to `srcset` presence** (`sizes={srcset ? SIZES : undefined}`), so an image the manifest doesn't know about degrades to a plain unsized `<img>` rather than emitting a `sizes` value that lies about a `srcset` that doesn't exist. Verified across `ArticleCard.astro`, `CategoryHero.astro`, `Header.astro` (three separate `sizes` derivations for three different thumbnail contexts), `ProductCard.astro`, `SearchPalette.astro`, and the section components `BannerPromo.astro`, `CategoryNav.astro`, `CollectionBento.astro`, `Hero.astro`, `ImageText.astro`.

`Hero.astro` additionally defers off-screen carousel slides' `srcset`/`src` behind a `data-srcset`/`data-src` promotion pattern woken by `requestIdleCallback` (with a `setTimeout` fallback for Safari <17, and the `(window as any).requestIdleCallback` cast noted in §2.1) — the component's own comment documents a prior regression where only the `<picture><source>`'s `srcset` was being promoted and the `<img>`'s own `srcset` was not, so a woken slide committed to the full 1920×1080 original ("measured on production: 74 KB + 32 KB wasted on one page, on a phone, for images that are not even on screen yet").

**This entire system is independently verified by four browser-driven scripts** (`apps/storefront/scripts/`): `check-image-widths.mjs` (disk-vs-disk, no server needed — proves every manifest `w` matches the real file and every referenced rendition exists), `check-hero-srcset.mjs` (proves the IMG's own `srcset`, not just the `<source>`'s, gets promoted on wake), `check-pdp-srcset.mjs` (proves gallery thumbnails aren't accidentally satisfied by a wider `srcset` candidate the main photo already fetched — a real HTML-spec interaction, not a hypothetical), and `check-search-srcset.mjs` (same class of check for the ⌘K search palette, which renders outside any static template). See §4 for why this suite's value is currently undercut by not running in CI.

**Gaps:**
- **`apps/landing` has no image optimization pipeline at all.** `astro.config.mjs` configures no `image` service, and neither `astro:assets` nor `<Image>`/`<Picture>` is imported anywhere in `src/`. The app's only two `<img>` tags (`LandingHero.astro:26-32`, `StoreDemo.astro:29-35`) both reference the same static file, `/storefront-demo-mobile.webp`, with explicit `width="390" height="844"` (so no CLS risk) but no `srcset` — every viewport and DPR downloads the identical fixed-size file. Low severity given the app currently ships exactly one distinct raster asset, but the pattern (and the total absence of an image service) has no headroom if landing grows beyond its current two images.
- **`apps/admin` adopts `next/image` in only 3 of the files that render images** (`akun/keamanan/security-client.tsx`, `files/files-client.tsx`, `pengaturan/pay-subscription.tsx`); roughly 10 other files use raw `<img>` (`article-editor.tsx:403`, `product-editor.tsx:628`, `collection-editor.tsx:632`, `product-thumb.tsx:21`, `store-profile-card.tsx:136,163`, `image-picker.tsx:67,162`, and four Puck theme-preview section components). Most of these carry an `eslint-disable-next-line @next/next/no-img-element` comment explaining the image URL is merchant-uploaded/arbitrary-remote and outside `next/image`'s configured loader allowlist — a documented tradeoff, not an oversight — but `next.config.ts` in both `apps/admin` and `apps/super-admin` configures no `images.remotePatterns`/`images.formats` at all, so the tradeoff has never actually been tested against turning `next/image` on for a scoped subset (e.g. same-origin `/api/uploads/*` assets, which the storefront's own `imageSrcSet` already knows how to serve responsively via `?w=`).

### 2.6 Core Web Vitals (LCP, INP, CLS)

**LCP** — `apps/storefront`'s `CategoryHero.astro` documents an explicit LCP incident: the category-page banner was `eager` + `fetchpriority="high"` (correctly, as the LCP candidate) but shipped with **no `srcset`/`sizes`** while every other catalog image went through `imageSrcSet` — closed by wiring it through the same system. `Hero.astro`'s slide-1 image is eager with a full `srcset`/`sizes="100vw"` (the component's own comment: "the hero is full-bleed, so one CSS pixel of viewport = one image pixel — `sizes="100vw"` is not an approximation here, it is the literal truth"), with slides 2..n deferred as covered in §2.5. Fonts are self-hosted and preloaded per §2.3, removing the third-party-origin round trip that the repo measured as 82% of the homepage `<h1>`'s render delay before the fix.

`apps/landing`'s hero image (`LandingHero.astro:26-32`) is `loading="eager" decoding="sync"` with explicit dimensions — appropriate for a presumed LCP element — but as noted in §2.5 has no responsive `srcset`, so mobile devices download the same file sized for its largest use.

**CLS** — every `<img>` audited across `apps/storefront` and `apps/landing` carries explicit `width`/`height` or is constrained by a fixed-aspect wrapper (`ProductCard.astro`'s `ASPECT_LOCKED = "aspect-square"`); `Hero.astro`'s slides declare `width="1920" height="1080"`. `MotionLayer.astro` (landing) animates only `opacity`/`transform` (compositor-only, no layout-triggering properties) and is gated behind `prefers-reduced-motion: no-preference`.

**INP / TBT** — `apps/storefront` ships zero hydrated JS by construction (§2.2). `apps/landing`'s one `client:load` island is the one clear, fixable INP-adjacent finding in this audit (§2.2, §5.2). `apps/admin`: 105 of ~350 `.ts`/`.tsx` files declare `"use client"` (~30%, expected for a drag-drop/inline-edit internal tool), and neither app uses `next/dynamic` anywhere (zero matches in a full grep) — the two heaviest third-party dependencies, `@measured/puck` (drag-drop editor) and the `@tiptap/*` rich-text editor stack, are statically imported into their route bundles (`apps/admin/app/(admin)/tema/[id]/builder-client.tsx:1-13`, `apps/admin/app/(admin)/blog/[id]/article-editor.tsx:27`, `apps/admin/app/(admin)/halaman/[id]/page-editor.tsx:21`) rather than code-split, meaning every visit to the theme builder, blog editor, or page editor route ships that dependency's full bundle up front regardless of whether the user ever opens it. `recharts` (charting) is a further static dependency with the same characteristic.

**Regression coverage** — `apps/storefront/scripts/check-pixel-defer.mjs` and `check-h1-floor.mjs` extend the CWV story beyond images: the former asserts that every tracking-pixel channel a tenant has enabled is stubbed and deferred until interaction (not loaded eagerly, and reads the *actually enabled* channel set per store rather than asserting a fixed list, avoiding both false-red and false-green); the latter is an HTTP-level check that a merchant-assembled homepage always renders exactly one `<h1>` (guards against 0, guards against >1 from a multi-slide hero, and guards against a hero slide with an image but no heading text producing an empty `<h1></h1>`) — an SEO/accessible-structure guard that unit tests structurally cannot reach because the bug lives in which database-driven section happens to render the heading.

### 2.7 Memory / Query Footprint

**Schema/migration drift (the most consequential finding in this section).** `packages/db/src/schema.ts` (2,098 lines, the single Drizzle source of truth for ~90 tables) declares **no `index()`/`uniqueIndex()` at all** on `orders`, `payments`, `order_line_items`, `customers`, `leads`, or `checkout_sessions` — yet two migrations fixed real production incidents by adding indexes directly via raw SQL and never mirrored them back:

- `packages/db/drizzle/0083_tracking_reconcile_indexes.sql`: `create index if not exists orders_store_placed_idx on orders (store_id, placed_at);` and `tracking_event_deliveries_order_idx on tracking_event_deliveries (order_id);` — the migration's own comment: *"Neither column was indexed, so without these the sweep is two sequential scans of the orders table once a minute."*
- `packages/db/drizzle/0085_payment_lookup_indexes.sql`: `payments_trx_idx`, `payments_reff_idx`, `payments_order_idx` — comment: *"the table has only its primary key"* before this migration.
- `order_line_items.order_id` has **never** had an index in any of the 95 migrations (only an FK constraint, which Postgres does not auto-index) — `apps/admin/lib/data/order-detail.ts:265` runs a full scan of this table on every order-detail page view as it grows.

Because `schema.ts` is the input to `drizzle-kit generate`, this drift means the tool cannot see the indexes that already exist in the live database — the next schema diff risks either silently omitting them from a fresh environment or generating a spurious drop/recreate migration against production.

**Unbounded list queries.** A working, paginated pattern exists (`apps/admin/app/(admin)/pesanan/page.tsx:14-42` calls `getOrderList({ page, pageSize: PAGE_SIZE })`, `PAGE_SIZE = 10`; `apps/super-admin/lib/data.ts` has `getStoreActivity()` with `.limit(20)` and `getGmvByCity(limit = 8)`), but it is not applied uniformly:

| Helper | File | Consumers |
|---|---|---|
| `getOrders()` | `apps/admin/lib/data/orders.ts:59-63` | dashboard, `/analitik` |
| `getProducts()` | `apps/admin/lib/data/products.ts:76-103` | `/produk`, `/produk/inventori`, `/produk/kategori/*`, `/analitik` |
| `getCustomers()` | `apps/admin/lib/data/customers.ts:53-57` | `/pelanggan` |
| `getMenus()` (also N+1, see below) | `apps/admin/lib/data/menus.ts:12-25` | nav editor |
| leads list | `apps/admin/lib/data/crm.ts:18-20` | `/crm` |
| discounts list | `apps/admin/lib/data/discounts.ts:52-54` | `/diskon` |
| pages list | `apps/admin/lib/data/pages.ts:25-27` | `/halaman` |
| `getStores()` | `apps/super-admin/lib/data.ts:106-109` | `/toko` |
| `getSubscriptionStats()` | `apps/super-admin/lib/data.ts:118-121` | dashboard |
| `getActivity()` | `apps/super-admin/lib/data.ts:679-682` | activity feed |
| `getPayouts()` / `getPayoutSummary()` | `apps/super-admin/lib/data.ts:858-861,893-896` | `/pencairan` |

All of these are RLS-scoped (admin: to one store; super-admin: platform-wide by design) so none are a cross-tenant data-exposure risk — but each grows linearly and unbounded with data volume, with no query-level cap. `getProducts()` is the most expensive: it runs three `LEFT JOIN`s (variants, inventory, media) with a `GROUP BY` over every non-archived product before any limit, followed by a second unbounded `inArray` query for every variant of every product returned — cost scales with `products × variants × inventory rows`, not product count.

**N+1 query.** `apps/admin/lib/data/menus.ts:12-25` — `getMenus()` selects every menu row, then issues one additional `menuItems` query per menu inside a `for` loop instead of a single `inArray(schema.menuItems.menuId, menus.map(m => m.id))` call. Low impact today (a store typically has 2 menus), but it is a per-row query pattern rather than a batched one, and will not scale if menu count grows. A second loop-embedded query was found in `apps/admin/lib/actions/purchases.ts:139-172`, gated behind a rare negative-inventory branch (one extra query per exceptional row, not a per-row list-render N+1) — lower priority.

**Connection pool.** `packages/db/src/client.ts`: `postgres(url, { max: 10 })` — a single hardcoded pool size with no `idle_timeout`/`connect_timeout`/`max_lifetime` override, shared across every Next.js server-side request via a `globalThis` cache to survive HMR/serverless reinvocation. Not wrong for current scale, but undocumented and untuned.

**In-process cache growth.** `apps/storefront/src/data/cache.ts` is a hand-rolled `Map`-based TTL cache (15s default, `STOREFRONT_CACHE_TTL_MS` overridable) with an in-flight-promise de-duplication guard (no thundering-herd on cache miss — a genuinely good pattern) but **no LRU or max-entry eviction**: an entry's `expires` timestamp is only checked on read, never proactively swept, so a key requested exactly once (e.g. a long-tail product/article/collection page hit by a crawler) sits in memory for the lifetime of the server process. The file's own comment flags this is intentionally provisional ("PROD SWAP: same interface, backed by Cloudflare Workers KV / Redis once the storefront runs behind more than one process"), so this is documented technical debt, not an oversight — but it is currently unbounded. By contrast, `apps/admin/app/api/cron/tracking-events/route.ts:48-61` explicitly creates fresh `Map`s per cron invocation specifically to avoid this class of cross-request growth — the codebase already contains the correct pattern elsewhere.

---

## 3. Edge Case, Regression & Vulnerability Assessment

| # | Area | Edge case / regression class | Evidence |
|---|---|---|---|
| 1 | Query footprint | A store that accumulates tens of thousands of orders/products/customers will see `/produk`, `/pelanggan`, `/crm`, `/diskon`, `/halaman`, and the admin dashboard degrade linearly with table size, with no pagination escape hatch in the UI to opt back into bounded reads. | §2.7, `apps/admin/lib/data/{products,customers,crm,discounts,pages}.ts` |
| 2 | Query footprint (super-admin) | Platform-wide, unbounded `getActivity()`/`getPayouts()`/`getStores()` scale with the *entire platform's* row count, not one tenant's — this is the more urgent instance of #1 because RLS does not bound it to a single store. | §2.7, `apps/super-admin/lib/data.ts` |
| 3 | Schema drift | Any future contributor reading `packages/db/src/schema.ts` to answer "is this column indexed?" for `orders`, `payments`, or `order_line_items` will get a wrong answer for three of those tables and a silently-missing answer for the fourth. A fresh environment stood up from `schema.ts` + migrations still gets the real indexes (they live in migration SQL), but a `drizzle-kit generate` diff run against the live schema will not. | §2.7, migrations `0083`, `0085` |
| 4 | Hydration cost | `apps/landing`'s hamburger menu forces its full React/Radix bundle to execute on every page load (including desktop, where it is never shown), on every visit, regardless of whether the visitor ever opens it. | §2.2, §2.6 |
| 5 | Bundle splitting | Visiting the admin theme builder, blog editor, or page editor ships `@measured/puck` or the Tiptap stack up front even if the merchant only glances at the route and navigates away. | §2.6 |
| 6 | Image optimization | `apps/landing` has zero headroom to add a second distinct image without either manually generating renditions or wiring up `astro:assets` for the first time — there is currently no image pipeline to extend. | §2.5 |
| 7 | Cache growth | A storefront container that stays warm for a long period while being crawled across many distinct product/article/collection slugs across many tenants accumulates one `Map` entry per distinct key ever requested, never evicted until overwritten. | §2.7, `apps/storefront/src/data/cache.ts` |
| 8 | Accessibility | A merchant/operator using a screen reader who submits an invalid form in `apps/admin`/`apps/super-admin` receives no `aria-invalid`/`aria-describedby` signal on the offending field — the visual error state is not exposed to assistive technology, even though the CSS to render it exists. | §2.4 |
| 9 | Type safety | `Hero.astro:362`'s `(window as any).requestIdleCallback` bypasses type checking on a feature-detection pattern that could instead use `"requestIdleCallback" in window` with no `any`. | §2.1, §2.5 |

No P0-severity (production-blocking, universal-input) defects were found in this batch's scope. All nine items above are latent/scaling risks or accessibility gaps, not active incidents.

---

## 4. Test Suite Coverage & Regression Matrix

| Package/app | `.test.ts(x)` files | Type-checked in CI? | Notes |
|---|---|---|---|
| `apps/admin` | 34 | `npx tsc --noEmit` (CI, `ci.yml`) | Vitest suite + explicit typecheck step. |
| `apps/super-admin` | 7 | `npx tsc --noEmit` (CI, `ci.yml`) | Same. |
| `apps/storefront` | 13 | `astro check` (CI, via `npm test` → `check:storefront`) | Type-level gate only; see below for the *behavioral* suite that is not wired in. |
| `apps/landing` | 0 | `astro check` (CI, via `npm test` → `check:landing`) | No Vitest unit tests; type-checked only. |
| `packages/lib` | 18 | — (no dedicated typecheck step; covered transitively by consuming apps) | Highest test density of any package — appropriate, as it is the most widely shared. |
| `packages/db` | 9 | — | Includes `verify-ledger.test.ts` (asserts FK/trigger integrity with a deliberately planted orphan), run as part of `npm test`. |
| `packages/ui` | 0 | — | Zero unit tests on shared, cross-app UI primitives; relies entirely on downstream app usage and manual/visual verification. |
| `packages/sections` | 0 | — | Types-only registry; low risk, but zero tests means a breaking `SectionType`/`config` shape change is only caught where a consumer (admin Puck, storefront renderer) happens to reference the changed field, not by a contract test on the registry itself. |
| `packages/data` | 0 | — | Small, static; low risk. |

**CI-executed commands** (`.github/workflows/ci.yml`, `test` job): `npm run verify-migrations -w @tokophi/db` → `npm test` (= `vitest run && astro check ×2`) → `npm run seed -w @tokophi/db` → `npm run verify-rls -w @tokophi/db` → `npm run verify-rls-app -w @tokophi/db` → `npx tsc --noEmit` in `apps/admin` and `apps/super-admin`.

**Gap: `apps/storefront`'s browser-driven performance/accessibility regression suite is not part of CI.** `apps/storefront/package.json` defines `"verify": "node scripts/run-checks.mjs"`, which runs six checks directly relevant to this audit's domain — `check-image-widths` (disk-vs-manifest integrity), `check-hero-srcset`, `check-pdp-srcset`, `check-search-srcset` (all covered in §2.5), `check-pixel-defer` and `check-h1-floor` (§2.6) — plus `checks-registered.test.ts`, a meta-test asserting every script on disk is actually registered in the runner (which *is* Vitest-discovered and runs in CI, but only proves the suite's own internal consistency, not that the suite itself executes). A repo-wide grep of `.github/workflows/ci.yml` finds no invocation of `npm run verify -w @tokophi/storefront`. `run-checks.mjs`'s own header comment states the design intent directly: it exists because a prior ad hoc invocation of three of these scripts by a reviewer produced "three regressions that did not exist," and draws an explicit parallel to `verify-rls`, which the same file says "sat red for weeks... nothing blocked either merge, because nothing ran" before two real cross-tenant leaks shipped past it. The repository has already internalized the lesson that an unrun check is not a check — that lesson has not yet been applied to this specific suite.

**Assessment:** unit/type-level coverage is strong and enforced. The gap is specifically in *behavioral* regression coverage for the exact domain this audit was commissioned to assess (image `srcset` correctness, third-party script deferral, heading-structure integrity) — the tests exist, are well-designed, and are simply not scheduled to run automatically.

---

## 5. Actionable Engineering Perfection Directives

### 5.1 Frontend — Type Safety

- **D1.** Replace `(window as any).requestIdleCallback` in `apps/storefront/src/components/sections/Hero.astro:362` with a type-safe feature check (e.g. `"requestIdleCallback" in window ? window.requestIdleCallback : undefined`), eliminating the only unguarded `any` on the storefront's LCP-adjacent code path.
- **D2.** Type the parsed chat payload in `apps/storefront/src/components/Chat.astro:177` (currently `d.messages.some((x: any) => x.sender !== "customer")`) against a minimal inline shape (`{ sender: string }[]`) rather than `any`, since the response shape is already implicitly relied upon three lines above (`d.conversationId`, `d.cursor`, `d.unread`).
- **D3.** Add a project-level `tsc --noEmit` (or equivalent) check for `packages/lib`, `packages/db`, `packages/ui`, `packages/sections`, and `packages/data` to CI. Today these are only type-checked transitively through consuming apps; a change isolated to a package with no immediate consumer edit (e.g. a `packages/ui` primitive nobody has touched downstream yet) has no direct CI signal.

### 5.2 Frontend — Accessibility & Hydration

- **D4.** Change `apps/landing/src/components/SiteHeader.astro:49`'s `client:load` on `<MobileNav>` to `client:idle` (or `client:visible` if the trigger is reliably below an above-the-fold breakpoint on all target devices) to remove unconditional hydration cost from every landing page view.
- **D5.** Wire `aria-invalid`/`aria-describedby` into `apps/admin` and `apps/super-admin` form fields at the point each app currently derives and displays a validation error message (both apps are `useState`-driven, not `react-hook-form`, so this is a local prop addition at each existing error-rendering call site, not a form-library migration) — the CSS variants in `packages/ui/src/components/ui/input.tsx:12` and `textarea.tsx:10` are already waiting for this signal.
- **D6.** Add `<TableCaption>` (already exported by `packages/ui/src/components/ui/table.tsx:98-103`) to the admin/super-admin data tables that currently render with no accessible summary of their own purpose.
- **D7.** Add a skip-link ("Lewati ke konten") as the first focusable element in `apps/landing/src/layouts/Base.astro`, landing on the `<main>` landmark; audit `apps/storefront` and `apps/admin` for the same gap, since neither surfaced one in this audit's searches either.
- **D8.** Extend `apps/landing/src/styles/global.css`'s dark-mode token block with the same systematic per-pair AA contrast verification comment style already established in `apps/storefront/src/styles/global.css` (§2.3) — currently only `--color-primary-ink` (6.4:1) is documented; `--color-muted`/`--color-ink-muted` and `--color-hairline` against `--color-canvas`/`--color-surface` are not.

### 5.3 Frontend — Performance / Core Web Vitals

- **D9.** Code-split `@measured/puck` (theme builder), the `@tiptap/*` rich-text editor, and `recharts` behind `next/dynamic` at their route boundaries (`apps/admin/app/(admin)/tema/[id]/builder-client.tsx`, `blog/[id]/article-editor.tsx`, `halaman/[id]/page-editor.tsx`, and any analytics route importing `recharts`) so their bundles ship only when a merchant actually opens those routes, not on every route in the app shell.
- **D10.** Give `apps/landing` an image pipeline before it needs one: adopt `astro:assets`/`<Image>` (Astro's built-in Sharp-backed service, currently entirely unconfigured — no `image` key in `astro.config.mjs`) for the two existing raster images, establishing the pattern before a third image is added ad hoc as a bare `<img>`.
- **D11.** For the ~10 admin files using raw `<img>` for merchant-uploaded content specifically served from the app's own `/api/uploads/*` route (as opposed to arbitrary third-party remote URLs), evaluate routing those through the storefront's existing `?w=`-aware `imageSrcSet`-equivalent pattern rather than `next/image`'s remote-loader allowlist, since the upload endpoint and its width-query contract already exist and are documented in `apps/storefront/scripts/gen-image-widths.mjs`'s header comment.

### 5.4 Database / Backend

- **D12 (highest priority in this report).** Reconcile `packages/db/src/schema.ts` with the indexes added by migrations `0083` and `0085` — add `index("orders_store_placed_idx").on(orders.storeId, orders.placedAt)`, `index("payments_trx_idx").on(payments.trxId)`, `index("payments_reff_idx").on(payments.reffId)`, `index("payments_order_idx").on(payments.orderId)`, and `index("tracking_event_deliveries_order_idx").on(trackingEventDeliveries.orderId)` to their respective table definitions, so `schema.ts` stops disagreeing with the database it describes. Follow with a migration adding the still-missing `order_line_items.order_id` index (never indexed in any of the 95 migrations) and a `(storeId, status)` / `(storeId, createdAt)` covering index for `products`, matching the filter/sort `apps/admin/lib/data/products.ts:79-104` already performs on every product-list page load.
- **D13.** Add `.limit()`/pagination parameters to the unbounded list helpers enumerated in §2.7's table, prioritizing `apps/super-admin/lib/data.ts`'s `getStores()`, `getActivity()`, and `getPayouts()`/`getPayoutSummary()` first (platform-wide scope, not RLS-bounded to one tenant), then `apps/admin/lib/data/products.ts`'s `getProducts()` (most expensive query shape, three joins + `GROUP BY` before any limit).
- **D14.** Batch `apps/admin/lib/data/menus.ts:12-25`'s per-menu `menuItems` query into a single `inArray(schema.menuItems.menuId, menus.map(m => m.id))` call, following the pattern `getProducts()` already uses for its own variant fetch.
- **D15.** Document (or explicitly tune) `packages/db/src/client.ts`'s hardcoded `max: 10` pool size and default `idle_timeout`/`connect_timeout` against actual concurrent-request expectations for the admin, super-admin, and storefront processes sharing this client module, since none of the three currently states an intended concurrency budget.
- **D16.** Add a proactive sweep (e.g. a periodic `for (const [k, v] of store) if (v.expires < Date.now()) store.delete(k)`, or a simple max-entry cap with LRU eviction) to `apps/storefront/src/data/cache.ts` ahead of the already-planned KV/Redis swap, so a long-running process's memory footprint is bounded by an explicit policy rather than by how many distinct pages have ever been requested.

### 5.5 CI / Process

- **D17 (second-highest priority in this report).** Add `npm run verify -w @tokophi/storefront` (or its individual `server: true` checks against a built preview) to `.github/workflows/ci.yml`, immediately after the existing `npm test` step where the storefront is already built. This closes the exact gap the repository's own `run-checks.mjs` header comment warns about, and brings the storefront's excellent CWV/accessibility regression coverage under the same automatic-enforcement guarantee the repo already gives `verify-rls`, `verify-rls-app`, and `verify-migrations`.
- **D18.** Add a minimal Vitest smoke suite to `packages/ui` (currently zero tests) covering the accessibility-load-bearing contracts of its shared primitives — e.g. that `Dialog`/`Sheet`/`Select` forward `aria-*` props and that `Input`/`Textarea`'s `aria-invalid` variant class actually applies when the prop is set — since every app in the monorepo depends on this package for its accessible-interaction baseline and a regression here is silent until it is felt downstream in four different apps at once.

---

*This report reflects the repository state audited on 2026-08-15. All findings are grounded in direct file reads, `grep`/`glob` evidence, and read-only sub-agent investigation; no application code, configuration, or test was modified as part of this audit.*
