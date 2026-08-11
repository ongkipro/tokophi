# Task — `check-h1-floor` picks a SERVABLE store (pre-existing FAIL)

**Start**: 2026-08-11, base `3a39f48` (origin/main), branch `fix/h1-floor-servable`,
worktree `.claude/worktrees/h1floor`.

## The defect

`npm run verify -w @tokophi/storefront` ran 5/6 PASS with `check-h1-floor` FAIL — pre-existing,
recorded in `HANDOFF_TENANT_THEME_TOKENS.md` and the 08-11 session log. The script's static-route
sweep picked its store with `order by created_at limit 1`: the oldest store on the seeded dev DB is
`gadget-murah-id`, **deliberately suspended**, and since SEC-1 a locked store 404s every public path
— so the check asserted ten 200s about a store the public is not allowed to see. The failure was the
check's premise, not the floor.

## The fix

Both store queries in `apps/storefront/scripts/check-h1-floor.mjs` now filter
`where s.suspended_at is null` — the same one-column predicate as the storefront's own
`isPubliclyServable` (`src/data/store-servable.ts`). Not `status`: the billing cron rewrites that
column (the reason store-servable.ts gates on `suspendedAt` in the first place). The second query
matters too: staging a homepage template on a suspended store would fail "is live" the same way.

## Checklist

- [x] Fix both queries (`suspended_at is null`)
- [ ] `npm run verify -w @tokophi/storefront` → must reach 6/6 PASS
- [ ] PR to main (number from `gh pr create` output, never guessed) → merge

NEXT: run the verify suite against the shared dev DB, then PR. No production data fix expected —
the change is one check script.
