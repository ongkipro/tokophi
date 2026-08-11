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

- [x] Handoff file (this one) committed before any code change
- [x] `packages/db/src/rename-batik-slug.ts` — idempotent rename, guarded against "already renamed"
      and "both slugs exist"; npm script `rename:batik-slug`
- [x] Wire it into `docker-compose.coolify.yml` migrate chain, non-fatal, after `seed.ts`
      (which creates the store on a fresh DB) and BEFORE the demo seed scripts
- [x] 301 redirect in `apps/storefront/src/middleware.ts` for the old label (base-domain form +
      sslip.io first-label form), path + query preserved
- [x] Sweep code defaults: compose `STORE_SLUG` default, `seed.ts` store slug, seed/one-off
      `DEMO_SLUG`/`SLUG` constants (products, journal, templates, demo-ratings, recent,
      backfill-ship-address), landing `PUBLIC_DEMO_URL` fallbacks + displayed address,
      `ops/tokophi-probe.sh` surface URL, current-fact comments
- [x] Update tests pinning the old value (`cart-message.test.ts`, `public-guard.test.ts`,
      `recovery.test.ts`); leave `store-slug.test.ts` (it tests `slugify()` behaviour, and
      `slugify("Batik Nusantara")` correctly remains `batik-nusantara`)
- [x] Verify: fresh `npm install`, test suites for touched packages, builds for admin, storefront,
      landing (super-admin build skipped — known env-dependent failure on a clean checkout)
- [x] PR (do not merge)

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

## Verified (2026-08-12, real runs)

- `rename-batik-slug.ts` driven against `tokophi_test` through all three states: fresh DB → "nothing
  to do"; old slug present → renamed (row read back as `batiknusantara`); both slugs present →
  loud refusal, no write. Fixture rows deleted afterwards.
- Prod storefront build served locally: `Host: batik-nusantara.tokophi.id` → `301
  https://batiknusantara.tokophi.id/produk/dress-batik?a=1&b=2` (path + query preserved); sslip.io
  first-label form 301s the same way; with a renamed store row the new host answers 200; unknown
  hosts still 404.
- `npx vitest run` on the touched suites (cart-message, public-guard, recovery, store-slug):
  35/35 green. Full `npm test`: 668 passed, **4 pre-existing failures** in
  `packages/db/src/doc-counts.test.ts` — the journal on origin/main (`d076cb1`) already holds 94
  migrations while AGENTS/STATUS/CODE_MAP/SCHEMA say 93; zero diff on those inputs in this branch,
  so it is main's doc bug, not this rename's (left for the branch that added `0093`).
- Builds: storefront ✓, landing ✓, admin ✓ (`build:admin` needs `DATABASE_URL` in a fresh worktree —
  no `.env.local` here). `astro check` storefront: 1 pre-existing error in `product-feed.test.ts`
  (missing `lastModified`, introduced by `dfe01a9` on main); landing check clean.

NEXT: merge the PR + watch the Coolify deploy land; update Coolify STORE_SLUG env if it is set explicitly; run `npm run rename:batik-slug -w @tokophi/db` once against the shared dev DB (announce first).
