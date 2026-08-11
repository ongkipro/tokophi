# Platform default theme — a platform-owned holder + decision-B fallback + /tema prefill

- Branch: `feat/platform-default-theme` (worktree), base `d076cb1` (origin/main, 2026-08-12).
- Owner ask: `batik-nusantara` is about to become a real merchant's shop. `theme-source.ts` says in its
  own doc comment what to do when that happens: *"copy its rows into a platform-owned holder rather
  than pointing at it live."* Do exactly that — plus: a new merchant opening /tema starts from the
  platform default (swap banner/text), never a blank drag-and-drop canvas.
- Governing decision: **decision B** (2026-08-06-open-work.md, UX-1): *"A store with no theme of its
  own shall render the platform default; a store that has customised its theme shall keep what it
  customised until it is deliberately reset."* Row-copies at provisioning were REJECTED there ("the
  seed is not a migration") — honored here: nothing is copied into any merchant's store, ever.
- ⚠️ This is a DELIBERATE semantic change from the shipped T-9 mechanism: `themeSourceStoreId` was an
  **unconditional override** (B-hard, every store renders the named store's theme). This task replaces
  it with a **per-slot fallback** (decision B as stated): a store's own homepage/category/product
  default wins when it has content; an empty slot falls back to the holder's row. After deploy +
  env repoint, a store with its own theme (e.g. `valoish-store`) regains its own theme.

## Plan

- [x] Handoff file committed first (this file, 45ceff6).
- [x] `@tokophi/lib/platform-theme` — fixed holder `stores.id` + slug constants (pure, no DB).
- [x] Reserve the holder slug in `RESERVED_SLUGS` (+ update the pinning test; the repo's slug guard
      also caught the seed as a fourth writer of `stores.slug` — named as a constant-slug exception).
- [x] `packages/db/src/seed-platform-theme.ts` — idempotent: create holder store (suspended, comped,
      approved — never publicly servable per `store-servable.ts`), copy `page_templates`
      (homepage/category/product, `is_default` rows) from slug IN ('batik-nusantara','batiknusantara')
      ONLY for types the holder doesn't already have. No schema change, no migration.
- [x] Wire it NON-FATAL into `docker-compose.coolify.yml`'s migrate chain (one line; a parallel task
      also edits this file — keep the diff minimal) + forward `PLATFORM_DEFAULT_THEME_STORE_ID` to the
      storefront and admin services (the SIGNUP_ENABLED lesson: an unforwarded var reaches nothing).
- [x] Storefront: rework `theme-source.ts` (pure, still no `@tokophi/db` import) from override to
      fallback; `getStoreTemplates` fills only empty default slots from the holder; tests updated.
      Bonus hardening: a non-UUID env value now reads as OFF instead of 22P02-500ing every page.
- [x] Admin: `/tema/[id]` prefills an EMPTY template's canvas from the holder's row of the same type
      (deliberate cross-tenant owner read, like `lib/auth.ts`); saving writes the merchant's own copy
      through the existing `saveTemplate` path. Render-only until the merchant publishes.
      `PLATFORM_DEFAULT_THEME_STORE_ID` classified in `env-health.ts` (the census guard caught it).
- [x] Verify: fresh `npm install`, vitest for touched packages, `npm run build` for admin + storefront
      (super-admin build skipped — known env issue on main).
- [x] PR opened (do NOT merge): body carries the decision-B behavior change + deploy notes.

## Verified (real command results, 2026-08-12)

- Fresh `npm install` in the worktree: exit 0.
- `npx vitest run` (full): **678 passed / 4 failed — all 4 pre-existing at base `d076cb1`**:
  `packages/db/src/doc-counts.test.ts` wants docs to say **94** migrations (base's
  `drizzle/meta/_journal.json` already holds 94 entries; AGENTS/STATUS/CODE_MAP/SCHEMA still say 93,
  counted 2026-08-11). Not touched here — it is a docs-territory fix for whoever merged `0093`.
- `npm run check:storefront`: **1 pre-existing error** from #259 (N13): `product-feed.test.ts:10`
  fixture missing the new required `lastModified` on `Product`. Also not touched here.
- Targeted suites (theme-source, platform-theme, store-slug, env-census): all green.
- `npm run build -w @tokophi/storefront`: exit 0. `npm run build:admin`: exit 0 — but only with
  `DATABASE_URL` (+`AUTH_SECRET`) in the env: page-data collection imports `@tokophi/db`, and a fresh
  worktree has no `.env.local`. Environmental, not a change in this branch.
- `npx tsc -p packages/db --noEmit`: exit 0.
- Seed exercised TWICE against the local dev DB (additive inserts only, no truncation): first run
  created the holder + copied homepage & product; second run copied 0 (idempotent). ⚠️ Local-only
  observation: the local batik store's `category` template is not `is_default`, so the script
  correctly skipped it and will complete on a later run — production (measured 2026-08-07) has all
  three as `is_default`, so the prod copy gets all three. The holder now exists in the local dev DB.

## Deploy notes (for the PR body too)

- Set `PLATFORM_DEFAULT_THEME_STORE_ID=a0000000-0000-4000-8000-000000000001` (the holder's fixed id)
  in Coolify for storefront + admin — it currently points at the live batik store id.
- The migrate chain seeds the holder automatically on deploy (idempotent; copies from the batik rows
  the first time, no-ops after).

NEXT: PR open — after review + merge + deploy, repoint PLATFORM_DEFAULT_THEME_STORE_ID in Coolify to
a0000000-0000-4000-8000-000000000001 (storefront + admin), then verify: a theme-less store renders the
default, valoish-store regains its own homepage, and a new store's /tema opens pre-filled.
