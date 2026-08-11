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

- [ ] Handoff file committed first (this file).
- [ ] `@tokophi/lib/platform-theme` — fixed holder `stores.id` + slug constants (pure, no DB).
- [ ] Reserve the holder slug in `RESERVED_SLUGS` (+ update the pinning test).
- [ ] `packages/db/src/seed-platform-theme.ts` — idempotent: create holder store (suspended, comped,
      approved — never publicly servable per `store-servable.ts`), copy `page_templates`
      (homepage/category/product, `is_default` rows) from slug IN ('batik-nusantara','batiknusantara')
      ONLY for types the holder doesn't already have. No schema change, no migration.
- [ ] Wire it NON-FATAL into `docker-compose.coolify.yml`'s migrate chain (one line; a parallel task
      also edits this file — keep the diff minimal) + forward `PLATFORM_DEFAULT_THEME_STORE_ID` to the
      storefront and admin services (the SIGNUP_ENABLED lesson: an unforwarded var reaches nothing).
- [ ] Storefront: rework `theme-source.ts` (pure, still no `@tokophi/db` import) from override to
      fallback; `getStoreTemplates` fills only empty default slots from the holder; tests updated.
- [ ] Admin: `/tema/[id]` prefills an EMPTY template's canvas from the holder's row of the same type
      (deliberate cross-tenant owner read, like `lib/auth.ts`); saving writes the merchant's own copy
      through the existing `saveTemplate` path. Render-only until the merchant publishes.
- [ ] Verify: fresh `npm install`, vitest for touched packages, `npm run build` for admin + storefront
      (super-admin build skipped — known env issue on main).
- [ ] PR opened (do NOT merge): body carries the decision-B behavior change + deploy notes.

## Deploy notes (for the PR body too)

- Set `PLATFORM_DEFAULT_THEME_STORE_ID=a0000000-0000-4000-8000-000000000001` (the holder's fixed id)
  in Coolify for storefront + admin — it currently points at the live batik store id.
- The migrate chain seeds the holder automatically on deploy (idempotent; copies from the batik rows
  the first time, no-ops after).

NEXT: build the lib constants + reserved slug, then the seed script.
