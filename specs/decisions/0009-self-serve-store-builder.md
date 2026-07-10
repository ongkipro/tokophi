# ADR 0009 — Self-serve drag-and-drop Store Builder (supersedes the "no theme editor" line in ADR 0003/0008)

**Status:** accepted · **Date:** 2026-07-09 · Amends ADR 0003 (scope) and ADR 0008 (storefront topology).

## Context
ADR 0003 decided "no Themes menu — storefronts are bespoke Astro sites, hand-built per client, not a self-serve theme editor." That's reversed: merchants must be able to build/customize their own storefront (homepage, category pages, product pages) themselves, drag-and-drop, no code — the product's differentiator, closer to Shopify's theme customizer / Leadpages / Elementor, but deliberately simpler and section-based (not free-form HTML/CSS).

This lands at the same time as the already-decided (`PROD_PLAN.md` §5, §8) pivot of the storefront from **SSG per-client build** to **SSR multi-tenant** (resolve store by `Host` header, one deploy for all stores). That pivot is *load-bearing* for this ADR: a self-serve builder only makes sense if a merchant's save is reflected immediately — which requires the storefront to read live from the DB per-request, not from a static build that needs a redeploy.

## Decision

**1. Mechanism: [Puck](https://github.com/puckeditor/puck)** (MIT, React-only, embedded in `apps/admin`).
Chosen over Craft.js (v0.x, infrequent maintenance) and GrapesJS (HTML/CSS-level, heavier, ships its own opinionated style-manager UI we don't want). Puck fits because it's section/component-based by design and ships a ready-to-use editor — we're not building canvas/drag-drop/reorder from scratch, only the section registry.

**2. Section registry, not free-form HTML.** A fixed, curated list of section components (Hero, Product Grid, Banner, Testimoni, Countdown, …) — each is a **pair**: a React component (rendered inside the Puck editor for live preview/props panel) and an **Astro render component** (rendered on the real storefront). Same `props`/config schema drives both. Merchants pick, arrange, and configure sections; they do not write markup. This keeps output lightweight (only sections that need interactivity ship JS, as Astro islands) and keeps visual quality consistent (we design every section once, to a high bar) instead of "anything goes."

**3. Three template surfaces, each independently themeable:**
| Page type | Cardinality | Assignment |
|---|---|---|
| `homepage` | 1 active per store | store-level default |
| `category` | many variants | picked per category (`collections.template_id`) |
| `product` | many variants | picked per product (`products.template_id`) |

Each template = an ordered list of `{ section_type, config }` stored as `jsonb` — see schema below.

**4. Checkout is locked — NOT part of the builder.** One canonical checkout flow/layout for every store (Shopify-style: merchants don't rebuild checkout). The only per-store variance is **branding tokens** pulled from the store's existing profile settings (logo, store name — already in `stores`/`store_settings`), not new builder-editable content. Rationale: checkout is the highest-risk, highest-conversion-sensitivity page; standardizing it removes an entire class of merchant-introduced bugs and keeps payment/shipping integration (ADR 0004) uniform.

**5. Storefront rendering stays live (no rebuild on save)** — this is *why* the SSR-multi-tenant pivot (`PROD_PLAN.md` §5) matters here: the same request that resolves `store_id` from `Host` also fetches that store's active template JSON and renders it. Saving in the builder = next page load reflects it. (A CDN-cache layer, if added later per `PROD_PLAN.md` §4/§6, needs cache invalidation on template save — noted as a follow-up, not a blocker for MVP.)

**6. Responsive by construction.** Every section is designed mobile-first with defined breakpoints as part of its spec — not an afterthought pass. A section isn't "done" until its mobile layout is reviewed.

## Amends
- **ADR 0003**, "Decision" bullet 1 (*"No self-serve theme editor/store"*) is **reversed**: there IS a self-serve builder now, scoped to section-based page building (homepage/category/product). "No Apps/Plugins marketplace" is **unchanged** — still no third-party extensibility.
- **ADR 0003**, "Consequences" bullet (*"Storefront customization is a service (we build it), not a product feature"*) is **reversed**: customization is now a **merchant-facing product feature** (the builder), not an agency service per client.
- **ADR 0008**, storefront row (*"1 templated codebase, 1 deploy per client"*) is **superseded** by the SSR-multi-tenant model already decided in `PROD_PLAN.md` §5: **1 codebase, 1 deploy, serves all stores**, resolved by `Host`/custom domain. `STORE_SLUG`-per-deploy is dropped in favor of runtime hostname → `store_id` resolution.
- **ADR 0008**, trade-off bullet (*"storefront customization beyond tokens/config = a branch/override per client"*) is **reversed** — see point 2 above.

## Data model (sketch — see `SCHEMA.md` for the canonical version once migrated)
```
page_templates(id, store_id, type enum[homepage|category|product], name,
                sections jsonb,        -- ordered [{ type, config }]
                is_default bool,       -- true for the store's single active homepage template
                created_at, updated_at)
collections.template_id  → page_templates(id) null   -- which `category` template this collection uses
products.template_id     → page_templates(id) null   -- which `product` template this product uses
```
- `store_id`-scoped like every other tenant table — same RLS/RBAC pattern as the rest of admin (`withTenant`/`requireCapability`, new capability `theme:write`).
- Falls back to a seeded platform-default template per type when `template_id` is null (so new stores/products aren't blank).

## Consequences
- **New admin screen**: a "Tema"/Store Builder section in `apps/admin` (Puck-embedded), gated behind a new RBAC capability (`theme:write`), following the same editor pattern (`lib/actions/theme.ts`, `lib/data/theme.ts`) as every other module.
- **Storefront becomes a template-interpreter**: `apps/storefront` needs (a) the SSR/hostname-resolution work already tracked in `PROD_PLAN.md`, and (b) a section-renderer that maps `sections[].type` → the matching Astro component.
- **Section registry is the new curated surface** — adding a section type is a deliberate design+code task (component + schema on both sides), not user-authored.
- Checkout code (`apps/storefront/src/pages/checkout*`) is explicitly **out of scope** for the builder; only reads branding fields already in `stores`/`store_settings`.
- This does not reopen "No Apps/Plugins marketplace" (ADR 0003) — the section registry is curated by us, not an open plugin surface.

## Implementation status (2026-07-10)
**Shipped (v1, homepage only), verified end-to-end (login → drag-drop → publish → Postgres → `astro build` → rendered HTML):**
- `page_templates` + `template_id` FKs + `stores.logo_url`/`brand_color` — migrations `0031`/`0032` (renumbered after rebasing onto the concurrent `super-admin-overhaul` work, which took `0026`–`0028`), RLS enforcing.
- `@tokophi/sections` — shared registry package (types + defaults), 8 sections: Hero, Product Grid, Banner Promo, Testimoni, Image + Teks, Marquee, Rich Text, Navigasi Kategori.
- `apps/admin` — Puck (`@measured/puck`, MIT) wired at `/tema`, gated by RBAC `theme:write` (owner/admin only); `lib/actions/theme.ts` upserts the store's single default homepage row.
- `apps/storefront` — matching Astro components per section + `SectionRenderer.astro`; `index.astro` renders the merchant's saved template when one exists, else falls back to the original hand-built homepage (safe default for stores that haven't used the builder yet).

**Deferred (explicit follow-ups, not started):**
- Category/product template variants (many-per-store, assignable per collection/product) — v1 only covers the single homepage template. `page_templates.type` already supports `category`/`product`; the admin UI to manage multiple named variants and assign them doesn't exist yet.
- **SSR multi-tenant storefront** (resolve `store_id` from the `Host` header, one deploy for all stores) — `apps/storefront` is still SSG today; this is the pivot `PROD_PLAN.md` §5 already called for, tracked as its own larger infra project, not bundled into this pass. Until it lands, a builder save requires a rebuild/redeploy to appear on a *deployed* storefront (local `astro build`/dev already reflects it immediately, since both read the same live DB at build/dev time).
- Checkout branding wiring (`stores.logo_url` → actual checkout page markup) — column exists, not yet read by `checkout.astro`.

## Amendment 2 (2026-07-10) — "Palet Warna": multi-palette colour system

**Context.** v1 shipped one global brand hex (`stores.brand_color`) that auto-generates a single tonal ramp (`@tokophi/lib/colors`) applied storefront-wide. That's a starting point, not the target — Shopify's real theme system (Dawn's `color_scheme_group`, see `shopify.dev/docs/storefronts/themes/architecture`) instead lets a merchant define **several named palettes** and assign a *different one per section instance*, so a page can alternate light/dark/accent bands (the "rhythm" a premium theme has). This amendment adopts that pattern, adapted to our simpler section model.

**Naming:** the merchant-facing term is **"Palet Warna"** (not "skema" — more concrete for a non-technical merchant, and doesn't collide with "Tema Toko," the builder's own name). Internally, code/DB identifiers stay English (`color_palettes`, matching every other table's convention of English schema + Indonesian UI labels).

**Decision — two-layer model, same shape as Shopify's:**
1. **Role definition (fixed, not merchant-editable):** every palette has exactly 5 roles — `background`, `text`, `button`, `buttonText`, `accent`. Deliberately smaller than Dawn's role set (which also has border/shadow/gradient variants) — enough to feel like a real theme system without the field-count creeping into "heavy."
2. **Named instances (merchant-editable, store-scoped):** a new `color_palettes` table holds any number of named palettes per store (e.g. "Terang", "Gelap", "Promo"), each a concrete hex value per role. Two are auto-seeded from the existing `stores.brand_color` the first time a store opens the palette manager — light-on-white and white-on-dark — so nothing breaks for stores that never touch this (backward compatible with v1's single-colour behaviour).
3. **Per-section assignment:** every section instance gets an optional `paletteId` (stored inside its own `props`, alongside its other config — not a new top-level DB column, exactly like Shopify stores `color_scheme` as a section *setting*, not a schema-level field). Empty/unset = falls back to the store's first/default palette, so existing saved homepages keep rendering unchanged.
4. **Rendering:** each section's root element gets its resolved palette's 5 values as inline CSS custom properties (`--scheme-background`, `--scheme-text`, `--scheme-button`, `--scheme-button-text`, `--scheme-accent`); the section's own markup references them via Tailwind arbitrary-value utilities (`bg-[var(--scheme-background)]`) instead of the old hardcoded `bg-brand-*` classes. This is a per-instance override, layered *on top of* the existing brand-shade system (which still governs anything a section doesn't explicitly theme, e.g. product cards' rating stars).

**Consequences:**
- New table `color_palettes` (RLS-scoped like every tenant table) + a "Kelola Palet" manager in the `/tema` builder header (list/add/edit/delete), alongside the existing brand-colour dialog.
- All 8 section configs in `@tokophi/sections` gain an optional `paletteId` field; Puck's field for it is dynamically populated from the store's current palette list (not a static option array like the other selects).
- The 8 paired Astro/React components are refactored to read palette-scoped CSS vars for background/text/button/accent roles instead of the global `brand-*` Tailwind classes — a mechanical but real change across all 16 files (admin preview + storefront render, ×8 sections).
- Does **not** replace `stores.brand_color`/`generateBrandShades` — that remains the zero-config default tonal ramp for chrome the builder doesn't touch (header, footer, buttons outside section content). Palettes are an *additional*, opt-in layer for section-level control.

**Shipped (2026-07-10), verified end-to-end:** schema (`color_palettes`, migration `0034` + RLS `0035`) + CRUD (`getOrSeedPalettes`/`savePalette`/`deletePalette`) + "Kelola Palet" manager dialog + dynamic Puck `paletteId` field on all 8 sections + all 16 paired components (8 admin preview + 8 storefront Astro) rendering from resolved `--scheme-*` CSS vars. `tsc`/`astro check` clean, `verify-rls` green; a real `astro build` with two palettes assigned to two sections on one page confirmed distinct colour sets rendered per section. Still uncommitted, same as the rest of Epic 7 (see `TASKS.md`).
