# 2026-08-12 — rename store slug `batik-nusantara` → `batiknusantara`

**Branch:** `feat/batiknusantara-slug` · **base:** `d076cb1` (origin/main) · worktree `.claude/worktrees/slug-rename`

## Scope

The owner is renaming the demo store's slug `batik-nusantara` → `batiknusantara` (no hyphen), so its
storefront moves to `https://batiknusantara.tokophi.id`. Data-only rename (NO schema change, NO
migration): an idempotent one-off script does the `UPDATE stores SET slug`, wired into the Coolify
migrate chain BEFORE the demo seed scripts (they look the store up by slug and must find it under the
new one). The old hostname must **301** to the new one — recovery/WA links carrying the old host are
already in the wild, and search engines hold the old URLs. Everything in code that assumes the old
slug follows: compose `STORE_SLUG` default, landing demo-URL fallbacks, seed/one-off script
constants, tests that pin the old host.

Out of scope: the shared dev DB row (run `npm run rename:batik-slug -w @tokophi/db` there once,
announced — it is idempotent and touches one row), historical measurements in docs/comments that
describe the old slug as history, and the Traefik `.com → .id` redirect files (label-agnostic).

## Plan

- [ ] Handoff file (this one) committed before any code change
- [ ] `packages/db/src/rename-batik-slug.ts` — idempotent rename, guarded against "already renamed"
      and "both slugs exist"; npm script `rename:batik-slug`
- [ ] Wire it into `docker-compose.coolify.yml` migrate chain, non-fatal, after `seed.ts`
      (which creates the store on a fresh DB) and BEFORE the demo seed scripts
- [ ] 301 redirect in `apps/storefront/src/middleware.ts` for the old label (base-domain form +
      sslip.io first-label form), path + query preserved
- [ ] Sweep code defaults: compose `STORE_SLUG` default, `seed.ts` store slug, seed/one-off
      `DEMO_SLUG`/`SLUG` constants (products, journal, templates, demo-ratings, recent,
      backfill-ship-address), landing `PUBLIC_DEMO_URL` fallbacks + displayed address,
      `ops/tokophi-probe.sh` surface URL, current-fact comments
- [ ] Update tests pinning the old value (`cart-message.test.ts`, `public-guard.test.ts`,
      `recovery.test.ts`); leave `store-slug.test.ts` (it tests `slugify()` behaviour, and
      `slugify("Batik Nusantara")` correctly remains `batik-nusantara`)
- [ ] Verify: fresh `npm install`, test suites for touched packages, builds for admin, storefront,
      landing (super-admin build skipped — known env-dependent failure on a clean checkout)
- [ ] PR (do not merge)

## Deploy notes

- Coolify env: if `STORE_SLUG` is set explicitly, update it to `batiknusantara` (this PR changes the
  compose default, which an explicit env var overrides).
- The DB rename runs automatically in the migrate chain on deploy; it is a no-op once renamed.
- The old host 301s to the new one via storefront middleware (both `<slug>.tokophi.id` and the
  sslip.io dev form).
- Shared dev DB (localhost:5433) still holds `batik-nusantara` until someone runs
  `npm run rename:batik-slug -w @tokophi/db` — announce before running it; scripts on this branch
  (`seed:recent`, `seed:products`, …) look for `batiknusantara` and fail loudly (not silently) until
  then.

NEXT: write packages/db/src/rename-batik-slug.ts and wire it into the compose migrate chain.
