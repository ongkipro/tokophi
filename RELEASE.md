# Release Manifest — tokophi

Release-ID: 4b0f4c8-pr381
Base: cbf261dfaf35080c13e81f77d17050d03ee0728b
Environment: production
Declared-Risk: R2
Rollback-Ref: cbf261dfaf35080c13e81f77d17050d03ee0728b
Rollback-Command: Coolify → application tokophi → Deployments → redeploy commit cbf261d (or `git revert -m 1 4b0f4c8` + push to `main` → webhook; ~8–9 min, specs/docs/DEPLOY.md)
Backup-Proof: NOT_REQUIRED
Status: DEPLOYED

## Contract

This file defines the current release boundary. It is repository truth for release-specific metadata and MUST describe only the release currently being prepared.

- `Base` is the last deployed/accepted commit and must be an ancestor of `HEAD`.
- `Declared-Risk` is the human/agent-declared release risk (`R0`–`R4`).
- `Rollback-Ref` is the commit to restore if deployment fails; normally it equals `Base`.
- `Rollback-Command` is an explicit supported repository/runbook command, not an assertion such as `true`. Do not put secrets here.
- `Backup-Proof` is `NOT_REQUIRED` unless migration risk requires a structured `backup://`, `snapshot://`, or artifact reference.
- Set `Status: READY` only after the release scope is frozen for production gating.

## This release — `4b0f4c8` (PR #381, merged 2026-09-04 03:37 UTC)

- **Scope** (`git diff --stat cbf261d 4b0f4c8`, 17 files): Super Admin `/log-sistem` screen over
  `platform_activity` (`apps/super-admin/app/(platform)/log-sistem/page.tsx`, `lib/activity-log.ts`
  + test), three control-plane actions now audit what they wrote (`removeStoreUser`,
  `setStoreComped`, `savePaymentChannels` — `lib/actions.ts`, `audit-writes.test.ts`), `route-roles`
  floor `admin` for the new route, regenerated `specs/docs/PAGE_MAP.md` / `page-map.json`, docs.
- **Why R2:** it changes mutating control-plane actions that reach every tenant (the super-admin
  surface AGENTS.md calls "the weaker of the two"), with real-Postgres tests beside each change.
  **No migration** — `packages/db/drizzle` is untouched between Base and this commit — so
  `Backup-Proof` is `NOT_REQUIRED` by the contract above. The nearest on-box dump anyway:
  `tokophi-20260904-115047.dump` (2026-09-04 11:50 UTC, the last one before the VPS was suspended
  that evening — BUILD-LOG 2026-09-07). Offsite copy: the `backup-offsite` sidecar is shipped but
  was `offsite-UNCONFIGURED` (no R2 credential) at the last log entry, 2026-09-03; not re-verified
  since (no SSH from this session by rule).
- **Review:** merged through a GitHub PR by the owner; no `delivery-ledger` run and no independent
  reviewer recorded for it (`.delivery/runs/` holds only the 2026-08-26 bootstrap run), hence
  `Independent-Review: PENDING` in `STATUS.md`. R2 does not require one under the state machine.
- **Deploy evidence:** Coolify auto-deploys `main` on merge, and production was serving on
  2026-09-07 (hosts 200/307, checkout cascade driven in Chromium). **The running image's commit was
  not read back** after the outage and BUILD-LOG records no deploy number for #380/#381 (last
  logged: deploy 528 = PR #378, 2026-09-03). `ops/check-deploy-currency.sh` on the box prints
  `running=<7-char sha>`; until it prints `4b0f4c8`, "deployed" rests on Coolify's default
  behaviour, not on a measurement.
- **Readiness for `VERIFIED`:** blocked by the `ongkir-rates` probe (KiriminAja IP allow-list
  refuses 45.77.33.112) — `STATUS.md` → Blockers. Not a property of this release; the same failure
  would hit `cbf261d`.

`~/dotfiles/bin/release-manifest .` reports this file as not gate-ready **on purpose**: `Status` is
`DEPLOYED`, not `READY`, because nothing is being prepared for production gating right now. Every
other field validates (Base is a real ancestor of HEAD, Rollback-Ref resolves, no `UNSET`).

## Next release

Nothing is frozen. Whatever merges next from `feat/sweep-0907` becomes the release this file
describes; rewrite the header then, with `Base: 4b0f4c8…`.
