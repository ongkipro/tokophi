# Task — N46: the credential sweep walks `packages/` too

**Start**: 2026-08-11, base `60b26a4` (origin/main), branch `fix/n46-credential-sweep-packages`,
worktree `.claude/worktrees/n46-sweep`.

## What changed

`packages/lib/src/no-published-credentials.test.ts` scanned `apps/` only, while 23 `.astro`/`.tsx`
files under `packages/{sections,ui}` — markup rendered into merchants' live storefronts — were
outside it. The scan roots are now `apps/` + `packages/` (the whole of it, not the two markup dirs —
"never bind a guard to a list of targets"), with TWO named exemptions where the strings are
legitimately load-bearing in literals:

- `packages/db/src/seed.ts` — CREATES the seeded accounts; the addresses are its output and the seed
  is not a shipped screen.
- `packages/lib/src/password.ts` — `PUBLISHED_PASSWORDS` is the deny-list; refusing `tokophi123`
  requires naming it.

The `public`-directory skip stays depth-anchored (now per scan root), and the hit display slices
from the repo root so `packages/...` paths print correctly.

## Proven, not assumed (both runs 2026-08-11)

- **Reach**: planted `<p>Dev: admin@tokophi.id / tokophi123</p>` as
  `packages/sections/src/__mutation-plant.astro` → 2 of 5 tests RED, the failure naming exactly that
  file. Removed → 5/5 green.
- **Exemptions are load-bearing**: `EXEMPT` emptied → 3 of 5 tests RED naming exactly
  `packages/db/src/seed.ts` and `packages/lib/src/password.ts`. Restored → 5/5 green.

## Checklist

- [x] Scan roots `apps/` + `packages/`, exemptions named with reasons
- [x] Mutation-proof both directions (plant → red; exemptions emptied → red)
- [x] Full `npm test` green (vitest + astro check, shared dev DB)
- [x] PR **#255** (number from `gh pr create` output) → squash-merge
