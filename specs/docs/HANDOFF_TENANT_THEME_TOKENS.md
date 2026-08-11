# Handoff — Tenant design-token system (storefront theming)

**Task**: The storefront's per-tenant look was one dial (`stores.brand_color` → `--color-brand-*`);
neutrals, the display font and the whole boutique vibe were platform-hardcoded. Built a precise
per-tenant design-token system: neutrals derived from brand hue × a tone choice, curated
self-hosted font pairings, one resolver — **Batik Nusantara is now the demo store's chosen preset,
not the global default**.

**Branch**: `feat/tenant-theme-tokens` (worktree `.claude/worktrees/tema-token`)
**Base commit**: b303fc9 (origin/main, 2026-08-11) — **DONE, verified, ready for PR**

## What shipped
- `@tokophi/lib/theme` (NEW, pure, tested 12/12): `generateNeutrals(brandHex, tone)` —
  temperature belongs to the room (cream/line take the tone hue), harmony belongs to the content
  (ink/muted take the brand hue), and **muted keeps the WCAG-AA lightness of the #736669 fix in
  every tone** (asserted ≥4.5:1 across 3 tones × 6 brand hues). `FONT_PAIRINGS` (bawaan/elegan/
  modern/klasik/tegas — display-only, body stays Inter, so a pairing costs ≤1 extra woff2).
  `resolveTheme()` — the ONE validator; garbage jsonb degrades to defaults and **never counts as
  chosen**.
- **Migration 0092** `stores.theme` jsonb (idempotent, verify-migrations green, stamp truthful).
- Storefront: `ThemeTokens.astro` — ONE injection site (Layout + LandingLayout). **Only chosen
  dials are emitted**: `theme NULL` → brand shades only, byte-identical to before (verified on the
  served HTML). 4 font families self-hosted in `public/fonts` (latin+latin-ext variable subsets,
  OFL), declared unconditionally in global.css (unreferenced @font-face downloads nothing),
  chosen one preloaded. CheckoutLayout untouched on purpose (checkout is locked/uniform).
- Admin `/tema`: "Tampilan" dialog (`theme-tokens-dialog.tsx`) — font rows previewed with the real
  CSS stacks, tone rows with live `generateNeutrals` swatches; `saveStoreTheme` action
  (`theme:write`, withTenant, `{ok,error}` like siblings).
- Seed: demo store gets `{font:"elegan", tone:"hangat"}` explicitly.

## Verified (2026-08-11, real browser)
- theme NULL → injected style identical to old brand-shades block; only Inter preloaded.
- elegan/hangat → cream/ink/line **byte-exact** vs static palette, muted ±1/255 (real brand hue),
  Playfair renders on H1, playfair woff2 preloaded.
- tegas/sejuk flip → whole storefront retints cool + Space Grotesk, zero deploy.
- Admin dialog end-to-end: login → pick Modern+Netral → "Tampilan toko tersimpan", row written,
  0 console errors. (First attempt correctly refused: demo's subscription was past due on the
  shared dev DB — `SuspendedError` from requireCapability, billing state restored after test.)
- `npm test` 654/654 · astro check 0 errors · admin tsc + lint 0 errors · verify-migrations green.
- `npm run verify -w @tokophi/storefront`: 5/6 PASS; **check-h1-floor FAIL is PRE-EXISTING** —
  its first block targets the OLDEST store (`gadget-murah-id`, seeded `suspended` → SEC-1 404s
  every path) and asserts that store "is live". Diff touches none of scripts/servable/middleware.

## ⚠️ The seed is not a migration
Existing deployments keep `theme = NULL` (= unchanged look — safe by design). The batik demo on
**production** shows the elegan preset only after an explicit data fix:
`update stores set theme='{"font":"elegan","tone":"hangat"}' where slug='batik-nusantara';`
(Applied to the shared dev DB already. Dev DB also received migrations 0091+0092.)

## Deferred (known ceilings)
- Dark tone; per-section palettes (concept from unmerged `worktree-color-palettes` — its code is
  pre-multi-tenant, salvage the idea only); italic subsets for the 4 display fonts (fallback
  synthesizes); `check-h1-floor` vs the deliberately-suspended seed store (pre-existing, above).

NEXT: PR to main → after merge, run the production UPDATE above (one row).
