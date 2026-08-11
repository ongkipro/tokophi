# 2026-08-12 — Post-ship adversarial audit: slug rename (#261) + platform theme holder (#262)

**Branch:** `audit/postship-review` · **Base:** `fc1ff17` (origin/main) · **Status:** OPEN

## Scope

Adversarial audit of the two change-sets that shipped and are live today:

- **PR #261** (squash `54ec917`) — store slug `batik-nusantara` → `batiknusantara`: rename script
  in the deploy migrate chain, 301 redirect in `apps/storefront/src/middleware.ts`, sweep of code
  defaults/seeds.
- **PR #262** (squash `f05b903`) — platform theme holder store `tema-platform` (fixed UUID
  `a0000000-0000-4000-8000-000000000001`, suspended, reserved slug, seeded by
  `packages/db/src/seed-platform-theme.ts`), `theme-source.ts` per-slot decision-B fallback,
  `/tema` editor prefill, env `PLATFORM_DEFAULT_THEME_STORE_ID` → holder.

Owner decision in force: `batiknusantara` REMAINS the demo store (no merchant migration).

Rules: prod DB access READ-ONLY (any prod fix = SQL written here, never run). Fix only what is
proved (failing test / measured query / driven request) with the smallest diff + pinning test.

## Attack surfaces

- [ ] ① Redirect middleware: custom-domain interaction, `batik-nusantara.`-prefixed custom
      domains, sslip first-label form, scheme derivation, loops, HEAD/POST, RESERVED host set vs
      `RESERVED_SLUGS` (`tema-platform` on the storefront host path), suspended-store servability
      of the holder (live requests to `tema-platform.tokophi.id`).
- [ ] ② Prod data still embedding old slug/host in VALUES (wa_templates, menu_items, recovery
      links, page content, analytics, store_settings) — measured read-only over SSH.
- [ ] ③ Theme fallback: `needsPlatformFallback`/`withPlatformFallback` edge cases (partial slots,
      holder id === store id, env unset/garbage, empty holder rows), 15s catalog cache, RLS/tenant
      leak via `/tema` prefill (`getPlatformDefaultSections` must only ever read the holder).
- [ ] ④ Seeds: rename script + seed-platform-theme idempotency under repeated deploys and both
      orderings; fresh DB vs live DB; anything still looking up the old slug.
- [ ] ⑤ Tests: do the shipped guards pin these behaviors, or green for the wrong reason
      (mutation-proof discipline).

## Verification gate before any PR

Touched test suites + `npm run build` for affected apps (super-admin build skipped).

## Findings

(recorded at close: CONFIRMED-FIXED / CONFIRMED-DEFERRED with exact fix / REFUTED with evidence)

NEXT: run the audit; update this file with every finding before closing.
