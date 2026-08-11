# Task — N62, second half: the ACCOUNT-keyed login brake

**Start**: 2026-08-12, base `951173c` (origin/main), branch `fix/n62-account-throttle`,
worktree `.claude/worktrees/n62-throttle`.

## What this closes

OPEN.md N62 shipped its first half (failed logins recorded per-burst to `platform_activity`); the
limiter itself stayed keyed on IP alone, so one named account could be ground at 15/min × as many
source addresses as the attacker holds. This half adds `failedLoginLocked(surface, email)`
(`packages/lib/src/cache.ts`): once an address's consecutive-failure streak reaches **25**, both
sign-in doors refuse attempts for that address before the password is checked.

Design points (all argued in the cache.ts comment):
- **25 = the second escalation rung** (5 → 25), so two audit rows always precede a lock — no account
  ever locks silently — and no human typo pattern reaches 25 straight failures.
- **A refused attempt never feeds the streak** — both callers check the lock BEFORE
  `recordFailedLogin`, so the attacker's own hammering cannot hold the victim's lock open; it
  self-expires 15 minutes (`FAILED_LOGIN_IDLE_MS`) after the last counted failure.
- **The lockout-DOS trade is named**: up to 15 minutes' lockout per 25-failure burst, accepted as the
  cheaper harm vs an unbounded distributed grind; the 60-bit mint stays the real wall.
- Same in-process-Map limitation as every limiter here; a floor, not a wall.

## Files

- `packages/lib/src/cache.ts` — `FAILED_LOGIN_LOCK_AT` + `failedLoginLocked()`
- `apps/admin/lib/actions/auth.ts` + `apps/super-admin/lib/actions/auth.ts` — the check, before
  `findLogin`/`findAdmin` (no scrypt spent on a locked attempt)
- `packages/lib/src/failed-login.test.ts` — 6 new tests: boundary (24 vs 25), success unlocks,
  per-door isolation, idle expiry with the "checking does not extend" property, source claims that
  both doors consult the lock, and a mutation self-check proving the claim can go red

## Checklist

- [x] Lock + callers + tests (20/20 green on the file)
- [x] Full `npm test` green · admin lint 0 errors (23 pre-existing warnings) · both `next build`s
      green (⚠️ builds need `DATABASE_URL` — page-data collection touches `/api/public/promo` — and
      `next start` needs `AUTH_SECRET` in prod mode; neither is new to this change)
- [x] Browser smoke, prod build: login works on BOTH panels (admin → `/store/batik-nusantara`,
      super → `/`), 0 console errors. The LOCK path itself is covered by unit + source-claim tests,
      not clicked (tripping it in a browser needs 25 fails past the 15/min IP cap — not worth the
      ceremony; the behaviourally risky half, the happy path, is what was driven)
- [ ] PR (number from `gh pr create` output) → merge
