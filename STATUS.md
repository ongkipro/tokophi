# Status — tokophi

Updated: 2026-09-08
Status: Active
State: SMOKE_TESTING
Review-Risk: R2
Independent-Review: PENDING
Primary-Worker: Main Session (Claude)
Independent-Reviewer: UNSET
Independent-Review-Head: UNSET

> **This file is a thin pointer, not a second status document.** The detailed, dated status
> (what is real / seeded / fake, test boundaries, release blockers) lives in
> [`specs/docs/STATUS.md`](specs/docs/STATUS.md). The execution queues are root
> [`TASKS.md`](TASKS.md) (audit-remediation stages) and [`specs/docs/TASKS.md`](specs/docs/TASKS.md)
> (the product breakdown the AGENTS.md protocol names). The execution log is
> [`BUILD-LOG.md`](BUILD-LOG.md). If this file and those disagree, those win — fix this one.

## Delivery state machine

Allowed forward path:

`PLANNED -> READY -> IMPLEMENTING -> VERIFYING -> REVIEWING -> INTEGRATING -> PRODUCTION_READY -> AWAITING_DEPLOY_APPROVAL -> DEPLOYED -> SMOKE_TESTING -> VERIFIED`

Use `BLOCKED` only as an interruption state. Record the blocker and exact state to resume. Do not skip verification/review/integration states. `production-gate` proves the transition from `INTEGRATING` to `PRODUCTION_READY`; it never deploys.

`RELEASE.md` owns release-specific truth: release ID, base, declared risk, rollback reference/command, backup proof, and readiness status. `Review-Risk` is the highest semantic risk found during review. `production-gate` computes effective release risk as max(`RELEASE.md` Declared-Risk, deterministic `diff-risk`, `Review-Risk`). R3/R4 require `Independent-Review: PASS`, a reviewer distinct from `Primary-Worker`, and `Independent-Review-Head` bound to the reviewed release content. Only review-attestation files may change after that commit.

`OBSERVABILITY.md` owns post-deploy verification probes. After deployment, transition to `SMOKE_TESTING` and run `release-check`. Every configured observability probe must pass before transition to `VERIFIED`.

## Current state

**The product is LIVE and has been since 2026-07-13** (`tokophi.com` landing · `app.` Seller panel ·
`rich.` Super Admin · `<slug>.tokophi.id` storefronts). One Vultr box (`volumdev`, 45.77.33.112)
running Coolify + `docker-compose.coolify.yml`; Postgres 16 with **106 migrations (`0000`–`0105`)**
and **82 tables** (counted from `packages/db/drizzle/meta/_journal.json` and `schema.ts`,
2026-09-08); RLS verified `54/55` store-scoped tables (`npm run verify-rls -w @tokophi/db`,
2026-09-08). Shape of the system: `ARCHITECTURE.md`.

**Why `SMOKE_TESTING` and not `VERIFIED`:** the latest release (`4b0f4c8`, PR #381, merged
2026-09-04 03:37 UTC) is on `main`, and production was smoke-tested on 2026-09-07 after the outage
below — four hosts 200/307, checkout address cascade driven in Chromium with 0 console errors — but
the shipping-rate probe FAILS (see Blockers), so no order can complete and `VERIFIED` is unreachable.
Which commit production is actually serving was not re-read after the outage; run
`ops/check-deploy-currency.sh` on the box (BUILD-LOG has no deploy number for #380/#381 — the last
logged verified deploy is 528, PR #378, 2026-09-03).

## Active work

Branch `feat/sweep-0907` (page-map report follow-ups; this file's rewrite is finding RH-2). Ordered
queue: `specs/docs/tasks/OPEN.md` → `NEXT.md`; stages in root `TASKS.md`.

## Blockers

- **OPEN — owner action, not code:** KiriminAja sandbox IP allow-list refuses `45.77.33.112`
  (`401 "Your IP address … were not allowed"` from inside the admin container, BUILD-LOG
  2026-09-07 11:53 UTC). Consequence: `/api/public/ongkir` rates → `SHIPPING_QUOTE_UNAVAILABLE` →
  no ongkir → no COD → **no order can be placed**. Fix: re-add the IP on the KiriminAja dashboard,
  then Super Admin → Pengaturan → "Tes koneksi KiriminAja". Resume at `SMOKE_TESTING` and re-run
  the `ongkir-rates` probe in `OBSERVABILITY.md`.
- **RESOLVED 2026-09-07:** production VPS suspended by Vultr for billing, 2026-09-04 20:27 WIB →
  2026-09-07 18:47 WIB (~70 h 20 min). Owner topped up; auto-resumed; 18 containers healthy within
  ~2 min. No orders were lost (`orders_since_sep1 = 0`); nothing could have been placed either.
  Nothing external noticed for 70 hours — recorded as the gap in `OBSERVABILITY.md`.

## Verification evidence

- `npm run verify-rls -w @tokophi/db` → `RLS verified` (12/12 checks), 2026-09-08, local dev DB.
- `node scripts/gen-page-map.mjs --check` → fresh (BUILD-LOG 2026-09-04 09:55 UTC).
- `npx vitest run` 2026-09-08 on this worktree: **141/142 files, 1152/1153 tests**. The one red is
  `test/page-map-fresh.test.ts` — `PAGE_MAP.md` is stale against *uncommitted* page edits by a
  parallel stream on this branch, not against HEAD (`4b0f4c8` was fresh per BUILD-LOG 2026-09-04);
  it clears when that stream runs `node scripts/gen-page-map.mjs`. Dated boundaries:
  `specs/docs/STATUS.md`.
- Production smoke 2026-09-07: hosts 200/307 + checkout cascade OK, rates FAIL (BUILD-LOG).

## Next verified action

Owner restores the KiriminAja allow-list → run `ops/tokophi-probe.sh` off-box + the rates probe →
confirm `running=<4b0f4c8>` via `ops/check-deploy-currency.sh` → transition `State` to `VERIFIED`.
