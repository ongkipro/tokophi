# ADR 0006 — Shared nav source: auto-connect admin ↔ storefront

**Status:** accepted · **Date:** 2026-07-02

## Context
The merchant admin has a **Navigasi** drag-drop menu builder, and the Astro storefront renders a header/footer nav. These were effectively duplicated: two hand-maintained lists that had to be kept in sync by copy-paste, guaranteeing drift (a link added in the builder wouldn't appear on the shop, and vice versa). We want the two surfaces to describe the *same* menu.

## Decision
- Introduce **`@tokophi/data`** with canonical `MAIN_MENU` and `FOOTER_MENU` (`MenuItem[]`, modeled on Shopify's Menu + MenuItem, with `itemType` ~ `MenuItemType`).
- **Both surfaces derive from it, no independent copies:**
  - storefront `src/data/nav.ts` maps `MAIN_MENU` → its `MAIN_NAV` (parents with children become dropdown triggers);
  - admin `lib/mock/store.ts` runs `toNavItems(MAIN_MENU / FOOTER_MENU)` to seed the builder's `MENUS`.
- **Sync model is staged:** *now* = **build-time sync** (edit the canonical file → rebuild → both update). *M3* = **backend-persisted live sync** — menus/menu_items stored in self-hosted Postgres so runtime edits in the admin builder go live on the storefront without a rebuild.

## Consequences
- **Single source of truth** for navigation; admin and storefront can no longer disagree about the menu shape.
- Data-layer discipline holds (ADR 0001): the storefront and admin read menus through their data seam, so swapping the canonical file for self-hosted Postgres reads at M3 is mechanical.
- **Runtime UI edits are not yet persisted:** the builder's drag-drop changes live in local React state only and reset on reload — real persistence is explicitly an M3 item, not a bug.
- `@tokophi/data` is the first package shared by *both* admin and storefront, validating the monorepo shape (ADR 0005).
