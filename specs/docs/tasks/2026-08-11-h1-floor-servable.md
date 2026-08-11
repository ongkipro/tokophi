# Task — `check-h1-floor` FAIL: the diagnosis was stale, the cause was HOST RESOLUTION

**Start**: 2026-08-11, base `3a39f48` (origin/main), branch `fix/h1-floor-servable`,
worktree `.claude/worktrees/h1floor`.

## What the record said, and what the database says

The 08-11 session log and `HANDOFF_TENANT_THEME_TOKENS.md` both diagnosed the pre-existing
`check-h1-floor` FAIL as "the oldest store (`gadget-murah-id`) is seeded suspended → SEC-1 404s".
**Measured 2026-08-11 against the shared dev DB: NO store is suspended** — all seven have
`suspended_at IS NULL` and `approved_at` set. The diagnosis was stale; the 404s were real but came
from somewhere else.

## The actual defect — two halves

1. **The suite's server could not explain any `<slug>.test` host but the demo's.** `hostOf()` falls
   back to `${slug}.test`, but `run-checks.mjs` never set `STOREFRONT_BASE_DOMAIN`, so
   `slugFromBaseDomain` yielded nothing, and the only resolvable host was `toko-demo.test` (a
   `store_domains` row). Since SEC-6 correctly refuses unexplained hosts (no more default-store
   fallback), every per-store Host header the check sends — the static sweep AND both staged-template
   blocks — was answered by the 404 page. (The "ok · h1 1" lines amid the FAILs were the 404 page's
   own single `<h1>`.) Fix: the suite's server env now carries `STOREFRONT_BASE_DOMAIN=test`, the
   same mechanism that makes `<slug>.tokophi.id` resolve in production.
2. **The check's store picks ignored servability.** `order by created_at limit 1` (and the staging
   query) would select a suspended store whenever one exists — and SEC-1 404s every path on a locked
   store, so the check would assert 200s about a store the public may not see. Both queries now
   filter `suspended_at is null` — the same one-column predicate as the storefront's own
   `isPubliclyServable` (`store-servable.ts`); not `status`, which the billing cron rewrites. On
   today's dev DB this filter changes nothing (nothing is suspended); it is what keeps the check
   honest the day a seeded-suspended store returns.

## Checklist

- [x] Both store queries filter `suspended_at is null`
- [x] `run-checks.mjs` server env: `STOREFRONT_BASE_DOMAIN=test`
- [x] `npm run verify -w @tokophi/storefront` → **6/6 PASS** (h1-floor 15 ok / 0 fail)
- [x] `npm test` (vitest + astro check) green against the shared dev DB
- [x] PR **#253** (number from `gh pr create` output) → squash-merge

NEXT: nothing — task closed. No production impact beyond the check scripts; the env line lives only
in the check runner. If the stale "seeded suspended" claim resurfaces in older docs, point it here.
