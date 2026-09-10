# Status — tokophi

Updated: 2026-09-11
Status: Active
State: VERIFIED
Review-Risk: R2
Independent-Review: PENDING
Primary-Worker: Main Session (Claude)
Independent-Reviewer: UNSET
Independent-Review-Head: UNSET

> **This file is a thin pointer, not a second status document.** The detailed, dated status
> (what is real / seeded / fake, test boundaries, release blockers) lives in
> [`specs/docs/STATUS.md`](specs/docs/STATUS.md). The one execution queue is root
> [`TASKS.md`](TASKS.md); [`specs/docs/TASKS.md`](specs/docs/TASKS.md) is the historical epic ledger
> (evidence, not a queue — `specs/README.md` authority table). The execution log is
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
running Coolify + `docker-compose.coolify.yml`; Postgres 16 with **109 migrations (`0000`–`0108`)**
and **83 tables** (counted from `packages/db/drizzle/meta/_journal.json` and `schema.ts`,
2026-09-11 — the count is guarded by `packages/db/src/doc-counts.test.ts`); RLS verified `54/55`
store-scoped tables (`npm run verify-rls -w @tokophi/db`, 2026-09-11). Shape of the system:
`ARCHITECTURE.md`.

**Release on production: `b888d66` (PR #395, Coolify deploy 539, `finished` 2026-09-10 ~18:16 UTC)** on
base `49e5f45` (PR #391, deploy 538); before those, 537 (`f5100ac`) and 536 (`98f1d5a`). Both deploys were matched by COMMIT in
`application_deployment_queues`, and the data they carried was read back from the production
database (migration stamp `1787545291751`; 74 017 courier village ids; VA fee 3000 in the live checkout
HTML and the running admin bundle) — `RELEASE.md`, BUILD-LOG 2026-09-10.

**Why `VERIFIED`:** every configured probe in `OBSERVABILITY.md` was run off-box on 2026-09-11 —
landing 200 · app 307 · rich 307 · storefront-demo 200 · `ongkir-search` 200 with "Kota Semarang" ·
`ongkir-rates` → PASS — 4 rates cod=2 originFrom=pickup sample=jne:REG23 Rp16000.
All green, so the state machine's condition for VERIFIED is met.
⚠️ **VERIFIED does not mean production is on the courier's PRODUCTION endpoint.** `KIRIMINAJA_ENV`
is `sandbox` on both admin and storefront (measured 2026-09-10), so every live ongkir is a sandbox
figure and no parcel is really booked — that is Task 8.9 (one authorised production booking, owner),
the substance of issue #5, and it is not a probe failure: the sandbox answers correctly.

## Active work

Everything from the 2026-09-10/11 session is on `main` and deployed (535–539, each matched by commit
and read back from production). Open: **#396** (README + release records; Markdown only). The
remaining queue is owner-gated (8.9 first production booking, 8.4 offsite backup credentials, 8.1 alert
channel, 8.5 branch pruning, 5.8 buyer accounts). Queue: root `TASKS.md` Stage 8; navigation handoff
`specs/docs/tasks/OPEN.md`. The remaining open items are owner-gated (8.9 first production booking,
8.4 offsite backup credentials, 8.1 alert channel, 8.5 branch pruning, 5.8 buyer accounts).

## Blockers

- **None that code can move.** The 2026-09-07 allow-list blocker is **RESOLVED** (owner re-added the
  IP 2026-09-09; rates verified live the same day and again today).
- **Owner-gated, not blocking the state machine:** production still on the courier sandbox (Task 8.9);
  no external uptime monitor / pager and no offsite backup credential (Tasks 8.1, 8.4 — the 70-hour
  outage of 2026-09-04→07 is why they matter; `OBSERVABILITY.md` "The gap").

## Verification evidence

- Release gate on the two merged PRs and the two open ones: lint 0 · `verify:guards` 0 · `test:release`
  up to **171 files / 1 494 tests** · RLS verified · storefront `verify` 8/8 (BUILD-LOG 2026-09-10/11).
- Production read-backs after deploy 535/536: BUILD-LOG 2026-09-10 16:40 UTC.
- Off-box probes 2026-09-11 (this file's "Why" paragraph); `ops/tokophi-probe.sh` is the same set and
  still runs on **no** machine on a schedule (Task 8.1).
- Doc authority: `node scripts/verify-doc-authority.mjs` → ok (8 documents, one queue).

## Next verified action

Owner merges #391/#392 (CI green) → Coolify deploy → re-run the probes above + confirm the seventh
cron sidecar reports on Super Admin → Analitik → Sistem → rewrite `RELEASE.md` header with
`Base: 98f1d5a…`. Then Task 8.9: one real production booking flips `KIRIMINAJA_ENV` off sandbox.
