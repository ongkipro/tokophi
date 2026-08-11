# 2026-08-12 — Salvage from `docs/local-task-headless-20260811`

**Branch:** `docs/salvage-headless`, cut from `origin/main` @ `4f20a0f` (post #265/#266/#267).
**Source branch:** `origin/docs/local-task-headless-20260811` @ `03d098c` (merge-base `dfe01a9`).
The headless branch touched 4 files; two were worth keeping, two were not.

## Taken

1. **`specs/docs/ARCHITECTURE_RECOMMENDATIONS.md`** — taken whole (355 lines, new file: monorepo
   decision + P0–P2 findings, assessment dated 2026-08-07 @ `a0107c3`). Added a salvage note +
   two dated corrections at the top; the original text was not rewritten:
   - the P0 backup finding is now re-observed (2026-08-12 DB-parity screen: ~6-hourly, local-only,
     no offsite copy), no longer merely "documented";
   - the P0 quality-gate finding was checked and remains accurate (CI exists per N59; Seller Admin
     lint still omitted; Storefront/Landing still have no `lint` script).

2. **`specs/docs/DEPLOY.md`** — semantic reconciliation on top of main's current version (main had
   moved via #265: `batik-nusantara` → `batiknusantara` slug rename; no hunk overlap). Taken from
   headless:
   - **Watch Paths `!**/*.md`** paragraph (LIVE since 2026-08-05; Markdown-only commits skip the
     5-image rebuild).
   - **Cron cleanup paragraph**: hourly at minute 17, 24h build-cache / 48h image pruning, two-stage
     aggressive mode at ≥70% used OR <25 GB free, `flock`. **Verified against the box 2026-08-12**
     (see below) — headless was more accurate than main here.
   - **"Alternative, not an addition"**: Coolify's own Docker Cleanup replaces the cron (no shared
     lock — never run both), instead of main's "enable it as well, cron is belt-and-braces".
   - Added (mine, not from either branch): a ⚠️ note that the tracked `ops/tokophi-docker-cleanup.sh`
     is still the **older daily/80% version** — the installed hourly script's source was never
     committed to any branch (checked all remotes for `AGGRESSIVE_PCT`), so the doc's `scp` install
     command would **downgrade** the box until someone commits the new script. That commit is open
     work; it was out of scope for a docs salvage.

## Rejected

- **`specs/docs/tasks/OPEN.md` changes** — the headless branch's board analysis and "recommended
  sequence" were built before the 2026-08-12 closures (#263–#267 etc.) and would regress the
  current OPEN.md, which main has since rewritten. Stale, superseded — dropped entirely.
- **`specs/README.md` changes** — same board-analysis stream; dropped per the salvage scope
  (only the two files above).
- **L2 probe threshold hunk (partially)** — headless rewrote check #3 to "alerts at ≥65% / <25 GB".
  That describes a probe that does not exist: `ops/tokophi-probe.sh` still defaults to
  **80% / 15 GB** (`TOKOPHI_PROBE_DISK_PCT`/`TOKOPHI_PROBE_DISK_FREE_GB`) and is installed nowhere.
  Kept main's numbers (they match the code), but headless's *reasoning* was right — the old
  justification ("80% = the cleanup's aggressive threshold") is stale now that the installed cleanup
  goes aggressive at 70% — so the doc carries a dated correction recommending ≥65% / <25 GB
  **when the probe is installed**, instead of silently documenting settings the script does not have.
- The `~/Projects/tokophi` capital-P path typo from the headless branch was not carried anywhere
  (grepped both salvaged files: absent).

## VPS verification (read-only, 2026-08-12)

```
$ ssh root@45.77.33.112 'cat /etc/cron.d/tokophi-docker-cleanup'
17 * * * * root /usr/local/bin/tokophi-docker-cleanup.sh
$ grep in /usr/local/bin/tokophi-docker-cleanup.sh
AGGRESSIVE_PCT="${TOKOPHI_CLEANUP_AGGRESSIVE_PCT:-70}"
MIN_FREE_GB="${TOKOPHI_CLEANUP_MIN_FREE_GB:-25}"
flock -n 9  (present)
```

Hourly schedule, 70%/25 GB thresholds and the flock all confirmed — the headless DEPLOY.md cron
paragraph documents the box as it actually runs.

## Guards checked

- `packages/db/src/doc-counts.test.ts` scans only `AGENTS.md` / `STATUS.md` / `CODE_MAP.md` /
  `SCHEMA.md` for the derived table/migration/enum counts — the new file is not in its list and
  publishes no such counts.

NEXT: main session reviews + merges `docs/salvage-headless` (serial, no PR auto-merge). Open work
surfaced by this salvage: commit the hourly `tokophi-docker-cleanup.sh` source so the repo matches
the box.
