# ADR 0003 — Scope (no Apps; Themes reversed by ADR 0009) + multi-tenancy model

**Status:** accepted, amended by **ADR 0009** (2026-07-09) · **Date:** 2026-07-01

> ⚠️ **Amended:** the "no Themes / no self-serve theme editor" decision below is **reversed** by [ADR 0009](0009-self-serve-store-builder.md) — merchants now get a self-serve, section-based drag-and-drop store builder. The "no Apps/Plugins marketplace" decision is unchanged. Original text kept for history.

## Context
Shopify's admin includes a **Themes** editor/store and an **Apps/Plugins** marketplace. The product intentionally omits both. Also need a multi-store model: one admin serving many merchants.

## Decision
- ~~No Themes menu. Storefronts are bespoke Astro sites, one per client, hand-built (by AI in the terminal). No self-serve theme editor/store.~~ **Reversed — see ADR 0009**: there is a self-serve, section-based store builder (homepage/category/product templates), embedded in `apps/admin`.
- **No Apps/Plugins marketplace.** Feature set is curated in-core; keeps the product lightweight and the surface small. *(Unchanged — the store builder's section registry is curated by us, not an open plugin surface.)*
- **Admin content mirrors Shopify's real entities** (Pages/Blog/Menu, screened via Shopify CLI) so merchants get familiar CMS/navigation control without themes.
- **Multi-tenancy:** lean toward **shared database + `store_id` scoping with Row-Level Security** (vs a DB per client) — simpler ops, cheaper, good enough with RLS. The topbar store switcher selects the active `store_id`.

## Consequences
- Smaller, faster, more opinionated admin than Shopify — matches the "lightweight, adaptif market Indonesia" goal.
- ~~Storefront customization is a service (we build it), not a product feature — fits the "1 client 1 deploy" model.~~ **Reversed — see ADR 0009**: customization is a self-serve product feature (the builder); storefront topology itself moves to SSR multi-tenant (ADR 0008 amendment).
- Backend work (ADR 0001 → M3) centers on RLS correctness; every query scoped by `store_id`.
- Revisit DB-per-client only if isolation/compliance needs demand it.

## Amendment — 2026-07-17: "`store_id` scoping" was one table short, and it leaked

**"Every query scoped by `store_id`"** (above) is the sentence that caused a real cross-tenant leak.
It is a fine rule for the 45 tables that HAVE a `store_id`. **`stores` is not one of them** — it is
keyed by `id`. So the table that *identifies* the tenant sat outside the model, outside RLS
(`relrowsecurity = false`), and outside the guard: `verify-rls` derives its coverage list from the
catalog *by looking for a `store_id` column*, so it could not see `stores` even in principle.

Two shipped functions did `db.select().from(stores).limit(1)` inside the tenant wrapper, trusting RLS
to pick the row. It returned an arbitrary store: a merchant read a stranger's shop name, tagline,
WhatsApp number and billing countdown — and because the paired *write* was correctly scoped, pressing
"Simpan" would have copied the stranger's name onto their own shop.

**Amended decision:** the tenancy rule is **"every query scoped to the tenant"**, not "scoped by
`store_id`". Where the tenant key is `id`, the policy keys on `id`. Migration `0058` enables RLS on
`stores` with `id = app_current_store_id()`; `verify-rls` asserts it explicitly because it cannot
derive it. The owner role still bypasses (no table uses FORCE ROW LEVEL SECURITY), which is what keeps
the legitimately cross-tenant paths — signup slug uniqueness, the billing cron, auth, super-admin, and
the Host-resolved storefront — working.

**The lesson worth more than the fix:** a coverage check that derives its own scope from a convention
will never flag the thing that breaks the convention. `verify-rls` had also been **red for weeks** (its
own fixture used the same `stores LIMIT 1`), so both leaks shipped past an alarm that was already
sounding. An alarm that is always on is an alarm that is off.
