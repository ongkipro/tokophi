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
- `page_templates` + `template_id` FKs + `stores.logo_url` — migrations `0026`/`0027`, RLS enforcing.
- `@tokophi/sections` — shared registry package (types + defaults), 4 sections: Hero, Product Grid, Banner Promo, Testimoni.
- `apps/admin` — Puck (`@measured/puck`, MIT) wired at `/tema`, gated by RBAC `theme:write` (owner/admin only); `lib/actions/theme.ts` upserts the store's single default homepage row.
- `apps/storefront` — matching Astro components per section + `SectionRenderer.astro`; `index.astro` renders the merchant's saved template when one exists, else falls back to the original hand-built homepage (safe default for stores that haven't used the builder yet).

**Deferred (explicit follow-ups, not started):**
- Category/product template variants (many-per-store, assignable per collection/product) — v1 only covers the single homepage template. `page_templates.type` already supports `category`/`product`; the admin UI to manage multiple named variants and assign them doesn't exist yet.
- **SSR multi-tenant storefront** (resolve `store_id` from the `Host` header, one deploy for all stores) — `apps/storefront` is still SSG today; this is the pivot `PROD_PLAN.md` §5 already called for, tracked as its own larger infra project, not bundled into this pass. Until it lands, a builder save requires a rebuild/redeploy to appear on a *deployed* storefront (local `astro build`/dev already reflects it immediately, since both read the same live DB at build/dev time).
- Checkout branding wiring (`stores.logo_url` → actual checkout page markup) — column exists, not yet read by `checkout.astro`.
