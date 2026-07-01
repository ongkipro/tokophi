# ADR 0003 — Scope (no Themes/Apps) + multi-tenancy model

**Status:** accepted · **Date:** 2026-07-01

## Context
Shopify's admin includes a **Themes** editor/store and an **Apps/Plugins** marketplace. The product intentionally omits both. Also need a multi-store model: one admin serving many merchants.

## Decision
- **No Themes menu.** Storefronts are **bespoke Astro sites, one per client**, hand-built (by AI in the terminal). No self-serve theme editor/store.
- **No Apps/Plugins marketplace.** Feature set is curated in-core; keeps the product lightweight and the surface small.
- **Admin content mirrors Shopify's real entities** (Pages/Blog/Menu, screened via Shopify CLI) so merchants get familiar CMS/navigation control without themes.
- **Multi-tenancy:** lean toward **shared database + `store_id` scoping with Row-Level Security** (vs a DB per client) — simpler ops, cheaper, good enough with RLS. The topbar store switcher selects the active `store_id`.

## Consequences
- Smaller, faster, more opinionated admin than Shopify — matches the "lightweight, adaptif market Indonesia" goal.
- Storefront customization is a service (we build it), not a product feature — fits the "1 client 1 deploy" model.
- Backend work (ADR 0001 → M3) centers on RLS correctness; every query scoped by `store_id`.
- Revisit DB-per-client only if isolation/compliance needs demand it.
