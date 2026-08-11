# Task — seed courier enablement aligned to production + saveCouriers finally logs

**Start**: 2026-08-12 ~03:30 WIB, base `4f20a0f` (origin/main), branch
`feat/n22-courier-seed-align`, worktree `.claude/worktrees/n22-courier`.

## Why

`2026-08-12-n41-remediation-executed.md` §③: production runs `idx=t, jtcargo=t, ninja=f` — the
opposite of the seed — and forensics (seed-epoch archaeology + `xmin` bracketing) showed that state
can only be an OPERATOR decision via `saveCouriers`, the one action on the courier card that never
wrote an audit line. Executed on the owner's blanket go-ahead this session ("yang belum dan perlu
dikerjakan, lanjutkan"); the evidence trail is in the record above if it ever needs revisiting.

## What changed

- `packages/db/src/seed.ts` — `COURIERS_OFF: ["idx","jtcargo"] → ["ninja"]`, with the forensic
  reference in place. **The seed is not a migration**: this touches FRESH databases only; production
  already IS this state (that is the point), and the shared dev DB is deliberately left alone.
- `apps/super-admin/lib/actions.ts` — `saveCouriers` now writes
  `logPlatform("Kurir diubah: …aktif/nonaktif…")`, the same shape as `saveGateways`/`saveCodAllowed`
  beside it. The question this closes: a courier toggle can never again be unanswerable from
  `platform_activity`.

Deliberately NOT done: flipping the shared dev DB's `platform_couriers.enabled` to match (a data
write other sessions may be relying on mid-test — dev drift vs prod on this column is now
documented as operator-intent, not a defect), and the demo store's `idx:00`/`jtcargo:REG` picked-set
question (still the owner's, unchanged).

## Checklist

- [x] Seed aligned + comment carries the forensic pointer
- [x] `saveCouriers` logs (same shape as siblings)
- [x] Full `npm test` SUITE_EXIT=0 · `build:super` green with `DATABASE_URL` set (the first run's
      failure was the known env-less page-data collection, not this change)
- [ ] PR (number from `gh pr create` output) → merge
