# Status — tokophi

Updated: 2026-11-15
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
`rich.` Super Admin · `<slug>.tokophi.id` storefronts). **Since 2026-11-01 18:53 UTC production runs on
a dedicated Vultr host** (Singapore, 2 vCPU / 4 GB, Ubuntu 24.04, Coolify 4.5.3) — runbook
`specs/docs/DEPLOY.md`, bootstrap history `specs/docs/tasks/2026-11-01-dedicated-vps-bootstrap.md`;
host identifiers are device-local (SSH alias `tokophi-new-ops`). The old box `volumdev` is retired.
Postgres 16 with **127 migrations (`0000`–`0126`)**, equal on the repo journal and production
(BUILD-LOG 2026-11-15); the table count is guarded by `packages/db/src/doc-counts.test.ts`.
⚠️ A merge to `main` deploys nothing on this host — the deploy is triggered by hand (`DEPLOY.md` step 2).

**Release on production: `fc843b29` (PR #481, FK lookup indexes `0126`)**, deployed by hand 2026-11-15
~06:57 UTC — `RELEASE.md` (lists the releases since `0e4d950a`: Mengantar for the demo store, store-level
shipping provider, Bayar ulang, pricing ADR 0020, Kelola plugin, buyer account (dormant), affiliate programme).

**Why `VERIFIED`:** `ops/tokophi-probe.sh` run off-box 2026-11-15 06:58 UTC with
`TOKOPHI_SSH_TARGET=tokophi-new-ops` — landing 200 · app/login 200 · rich 307 · toko 200 ·
`batiknusantara.tokophi.id` 200 · `db_ongkir` search 200 with rows · ssh OK · disk 39 % / 54 GB free ·
L1 watchdog heartbeat 45 s; exit 0.

**Mengantar (Partner API) is live for the demo store only** (since 2026-11-12, owner-attached account,
non-COD; ADR 0018/0019): the provider is per store (Super Admin or a signup code), COD never goes via
Mengantar, every other store stays on KiriminAja. Registering further stores waits on the owner-gated
prerequisites (Partner API production origin, the host IP on Mengantar's allow-list) — `OPEN.md`.

## Active work

No code task active (2026-11-15). No open PRs after the 2026-11-15 sweep (BUILD-LOG 2026-11-15 07:05).
Waiting on the owner: `BUYER-ACCOUNT-ENABLE` (Google OAuth client, PDP text) and the affiliate follow-ups
in `specs/docs/TASKS.md`. Handoff: `specs/docs/tasks/OPEN.md`.

## Blockers

- **None that code can move.** The post-cutover KiriminAja allow-list block was resolved 2026-11-02
  (owner whitelisted the new IP; `cron-tracking` restarted).
- **Owner-gated, not blocking the state machine:** Mengantar production prerequisites (above); Task 8.9
  (KiriminAja production cutover); no external uptime monitor / pager (Task 8.1); GitHub webhook →
  Coolify blocked by Cloudflare Access (manual deploys); dropping `ops_backup.store_theme_20261105`.

## Verification evidence

- Deploy of `0e4d950a`: five web containers `(healthy)` on two polls, `migrate`/`seed` exited 0,
  probe exit 0, live storefront checked at 390 + 1440 px — BUILD-LOG 2026-11-05 12:25 UTC.
- Off-box probe 2026-11-05 19:45 UTC (this file's "Why" paragraph). `ops/tokophi-probe.sh` still runs
  on **no** machine on a schedule (Task 8.1).
- Doc authority: `npm run verify:doc-authority`.

## Next verified action

Wait for the owner's three Mengantar prerequisites → run the area import, set `MENGANTAR_ENV`, flip the
shipping switch, re-run `ops/tokophi-probe.sh`. Independently: serialise the open PR merges (each needs
a manual deploy here), renumbering the `0116` clashes first.
