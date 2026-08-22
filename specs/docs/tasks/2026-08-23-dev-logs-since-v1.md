# 2026-08-23 — Dev logs since v1.0.0 (Super Admin → Update Log Development)

**Worktree:** `.claude/worktrees/devlog` · **Branch:** `feat/dev-logs-since-v1` · **Base:** `origin/main` `94cabd1`
**Scope id:** `DOC-DEVLOG-1` · **Executor:** Claude (Opus 5), documentation-only pass.

## Why

`/update-log` on the Super Admin panel renders `DEV_LOGS` from
`apps/super-admin/lib/data/dev-logs.ts`. Its newest entry is **v1.0.0, 2026-08-15**. Everything that
shipped between **2026-08-16 and 2026-08-23** — the whole Stage 4 P0 close-out, the Stage 5 wave, the
money/goods audit, the ad-funnel outage, the v6.2 booking migration and the delivery-pipeline work —
is invisible to the operator reading that screen.

## The hard rule for this pass

**Every fact comes from `BUILD-LOG.md` or from a merged commit and the doc that commit changed.**
No invented number, no invented test count, no invented verification. Where an entry has no recorded
verification of its own, the entry says what WAS recorded instead of manufacturing a metric. A dev
log that overstates is worse than one that is terse.

## Plan

- [x] Read `AGENTS.md` protocol (TASKS.md → BUILD-LOG.md → STATUS.md → `specs/docs/tasks/`)
- [x] Read every `BUILD-LOG.md` entry dated 2026-08-16 onwards + `git log origin/main` for the range
- [x] Commit this handoff **before** touching the data file
- [x] Add the grouped entries to `apps/super-admin/lib/data/dev-logs.ts` (newest first, existing
      `DevLogEntry` shape, existing `DevLogCategory` / `DevLogSurface` unions — no new union members,
      so `CATEGORY_MAP` in `update-log-client.tsx` needs no change)
- [x] Leave the seven existing entries untouched
- [x] `npm install` fresh in this worktree (no hardlinked `node_modules`)
- [x] `npm run build -w @tokophi/super-admin` (typecheck + lint + build)
- [x] `npx vitest run` for the suites that touch these files
- [x] Record a `BUILD-LOG.md` entry with the real output
- [x] Tick the task in `specs/docs/TASKS.md`
- [x] Small logical commits · push · `gh pr create --base main` · **do not merge**

## Grouping (7 entries, newest first)

| version | date | grouped from |
|---|---|---|
| `v1.1.0` | 2026-08-22 | BUILD-LOG `[2026-08-22 15:35 UTC]` + `[2026-08-22 15:55 UTC]` — Task 4.12 / SEC-18 |
| `v1.0.6` | 2026-08-22 | commit `68764b0` + `SECURITY.md` §5 + `specs/docs/tasks/2026-08-06-open-work.md` |
| `v1.0.5` | 2026-08-22 | BUILD-LOG 5.2 · 5.3 · 5.16 · 5.10 · 5.17 · 5.11 · the `addStoreUser` addition |
| `v1.0.4` | 2026-08-21 | BUILD-LOG `[2026-08-21 09:20]` (4.13) + `[2026-08-21 08:20]` (4.11) |
| `v1.0.3` | 2026-08-21 | BUILD-LOG `[2026-08-21 16:10]` MONEY-AUDIT-1 + the postcode-outage entry |
| `v1.0.2` | 2026-08-20 | BUILD-LOG N40 phase 2 + the two drizzle/`exists()` scoping entries |
| `v1.0.1` | 2026-08-20 | BUILD-LOG 2026-08-16 → 2026-08-20: CI, deploy window, guards, screening A–J, 4.9/4.10 |

`package.json` is at `1.0.0`, so every number here is post-1.0.0 and the highest is the newest.

## Deliberately NOT included

- **Stage 5 Task 5.5** (the 24 pre-existing 320 px topbar overflows). It is *named* in the Task 4.1
  entry as "tracked separately by Task 5.5" and nothing else — no BUILD-LOG entry, no commit in the
  range. There is nothing shipped to report, so reporting it would be an invention.
- Per-PR granularity. Seven grouped releases, not twenty-odd commits.

## Result (measured)

- `npm install` fresh in the worktree → exit 0.
- `npx vitest run` → **exit 0 — 123 files / 1009 tests passed**, the same figure `origin/main` recorded
  on 2026-08-22: no test added, none broken.
- `npm run lint -w @tokophi/super-admin` → **exit 0 — 0 errors, 3 warnings** (the baseline; all three
  pre-existing in `update-log-client.tsx`).
- `npm run build -w @tokophi/super-admin` → **exit 0** with the Dockerfile's env; 15 routes including
  `ƒ /update-log`. ⚠️ A **bare** build in a worktree fails on the missing root `DATABASE_URL` —
  pre-existing (`.gitignore` is `.env*`), recorded identically for `apps/admin` on 2026-08-22, and it
  happens after Turbopack and TypeScript have both succeeded.
- Not clicked in a browser: seven data rows behind an unchanged renderer.

## NEXT

Nothing blocking. If the operator wants the KPI tiles at the top of `/update-log` refreshed
(`722 Tes Hijau`, `53 Tabel Gated`, `Current Engine: v1.0.0 Stable` are hard-coded in
`update-log-client.tsx` and are now stale against the 1009-test run recorded on 2026-08-22), that is
a separate, deliberate change to the screen — this pass only adds data rows.

⚠️ Unrelated, found while reading and left alone: `BUILD-LOG.md` carries three unresolved merge
artefacts (`||||||| a98321c`, `||||||| b2a659e`, `||||||| 0d6f1d1`) from an earlier merge. Not this
pass's file to repair.
