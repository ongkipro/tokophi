# Handoff — Tenant design-token system (storefront theming)

**Task**: The storefront's per-tenant look is one dial (`stores.brand_color` → `--color-brand-*`);
neutrals (`cream/ink/muted/line`), fonts (Inter + Playfair) and the whole "batik boutique" vibe are
hardcoded in `apps/storefront/src/styles/global.css` + `Layout.astro`. Build a precise per-tenant
design-token system: neutrals derived from the brand colour + a tone choice, curated font pairings,
one resolver — **Batik Nusantara becomes the demo store's chosen preset, not the global default**.

**Branch**: `feat/tenant-theme-tokens` (worktree `.claude/worktrees/tema-token`)
**Base commit**: b303fc9 (origin/main, 2026-08-11)

## Design decisions
- Utility token NAMES stay (`bg-cream`, `text-ink`, `border-line`, `text-muted`, `font-display`) —
  only their VALUES become per-tenant CSS custom-property overrides injected by `Layout.astro`
  (same mechanism the brand shades already use). No mass markup rewrite.
- Tenant choices stored in `stores.theme` jsonb `{ font, tone }` (migration 0050 — journal checked:
  0048/0049 `when` are now in the past, safe to append truthfully).
- Theme engine lives in `packages/lib` next to `colors.ts`: `generateNeutrals(brandHex, tone)`,
  `FONT_PAIRINGS`, `resolveTheme(store)`.
- Precision proof: demo store (Batik Nusantara) must render ~identical before/after; then flipping
  `theme` via targeted SQL must restyle the whole storefront.
- Deferred (known ceilings): dark tone; per-section palettes (concept from unmerged
  `worktree-color-palettes` — its code is pre-multi-tenant, salvage the idea only).

## Checklist
- [ ] Phase 1 — `packages/lib` theme engine (`neutrals`, `FONT_PAIRINGS`, `resolveTheme`)
- [ ] Phase 2 — migration 0050 `stores.theme` jsonb + schema.ts + seed batik preset
- [ ] Phase 3 — storefront: `Layout.astro` full token injection + dynamic font link;
      `global.css` neutral TokoΦ defaults
- [ ] Phase 4 — admin `/tema`: font pairing + tone pickers (`saveTheme`, RBAC `content:write`)
- [ ] Phase 5 — verify: demo identical before/after (screenshots), theme flip restyles,
      console 0 errors, `astro check` + builds green
- [ ] PR to main

NEXT: Phase 1 — write the theme engine in `packages/lib/src/`.
