# Release Manifest — tokophi

Release-ID: b888d66-pr395
Base: 49e5f45
Environment: production
Declared-Risk: R2
Rollback-Ref: 49e5f45
Rollback-Command: Coolify → application tokophi → Deployments → redeploy commit 49e5f45 (or `git revert -m 1 b888d66` + push to `main` → webhook; ~10 min measured on deploys 535–539, specs/docs/DEPLOY.md)
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

## This release — `b888d66` (PR #395, merged 2026-09-10 18:0x UTC; Coolify deploy **539**, `finished`)

- **Scope:** Super Admin front-door login, controlled mobile drawer, theme toggle, rank badge, grouped
  nav (Task 8.22) + its guards; Super Admin update-log `v1.6.0`. **No migration** → `Backup-Proof:
  NOT_REQUIRED`.
- **Why R2:** the control plane's shell and login are on every operator's path; the change is UI-only
  (no action, gate or data path touched — `route-roles` guard re-proved), proven in Chromium 21/21.
- **Deploy evidence, measured:** queue row 539 matched by commit; after it landed `rich.tokophi.com/login`
  serves the new door (eyebrow "Super Admin · control plane", `h1` "Masuk ke panel platform", the old
  description gone, no `defaultValue`, `h-11` submit), super-admin container healthy.
- **Preceding deploys on this branch of history:** 538 (`49e5f45`, #391 ADR 0004 — `TokoΦ Kirim` in 8
  admin bundle files, old string 0) · 537 (`f5100ac`, #393 carrying #392 — see below).

## Previous release — `f5100ac` (PR #393, merged 2026-09-10 17:30 UTC; Coolify deploy **537**)

⚠️ **This release carries MORE than its PR title says, and the error was mine.** `docs/root-contract-refresh`
was branched from `feat/payment-advice-cron` instead of `main`, so merging #393 ("docs only") also merged
every commit of **#392** — the payment-advice cron route, the `cron-payment-advice` compose sidecar, the
15 s `al()` timeout, the 20-char seller `reff_id`, the liveness-card additions. GitHub then marked #392
merged on its own (head reachable from `main`, empty diff). The code is exactly the commit that passed
CI 4/4 on #392, so nothing untested shipped — but the PR description, `STATUS.md` and the BUILD-LOG entry
all said "Markdown only — does not deploy", which was false the moment it merged. Corrected here, by
appending, never by rewriting.

- **Scope** (`git diff --stat 98f1d5a f5100ac`, 29 files, 11 non-Markdown): #392 in full + the root
  delivery-contract refresh + `LANDING_PRD.md` + the development-kit map in `specs/README.md`.
- **Why R2:** adds a seventh compose service that calls the payment provider every 15 minutes
  (read-only, bounded, proven by source to write no payment state) and a request timeout on every
  AutoLaris call. **No migration** → `Backup-Proof: NOT_REQUIRED`.
- **Verification owed after deploy 537 lands:** the `cron-payment-advice` container is `running`, a
  `payment-advice` row appears in `cron_runs` within one interval, and Super Admin → Analitik → Sistem
  shows it beside the (previously unlisted) `order-expiry`.
- **Lesson recorded:** `git checkout -b <new>` branches from *wherever you are*. Every branch meant
  for its own PR is now created as `git checkout -b <new> origin/main`, and `gh pr view --json
  baseRefName,commits` is read before opening the PR.

## Previous release — `98f1d5a` (PR #390, merged 2026-09-10 16:36 UTC; Coolify deploy **536**, `finished` 16:46 UTC)

- **Scope** (`git diff --stat fca0a2e 98f1d5a`): VA fee default Rp3.500 → Rp3.000 (DEC-011) in
  `packages/lib/src/payment-fees.ts`, the comparison guard flipped from "diverges" to "match", six
  docs/comments that published the old figure, Super Admin update-log `v1.5.0`. **No migration.**
- **Why R2:** it changes a money figure every prepaid checkout applies. Verified after deploy by
  reading the live checkout HTML (`data-fee-value` 3500 → 3000 on four banks, 6500 unchanged) and
  the running admin bundle (`value:3e3`, the minified 3000) — BUILD-LOG 2026-09-10 16:40 UTC.
- **Base `fca0a2e` (PR #389, deploy 535, `finished` 16:29 UTC)** carried migrations `0107` + `0108`
  (kelurahan courier ids; destination kelurahan on orders). Production verified after it: stamp
  `1787545291751` applied, 78 764 kelurahan rows with 74 017 courier ids, both `orders.ship_kelurahan_*`
  columns present. Rolling THIS release back to `fca0a2e` keeps those columns (idempotent, additive).
- **Review:** both merged through GitHub PRs on green CI (4/4 checks) by the owner's order; no
  independent reviewer recorded → `Independent-Review: PENDING` in `STATUS.md`. R2 does not require one.
- **Deploy evidence, measured this time:** `application_deployment_queues` rows 535 (`fca0a2e`) and
  536 (`98f1d5a`) both `finished`, matched by COMMIT, not by "latest terminal row".

## Previous release — `4b0f4c8` (PR #381, merged 2026-09-04 03:37 UTC)

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

Nothing is frozen. Open on GitHub: **#396** (README + these records; Markdown only, will not deploy).
The next code merge becomes the release this file describes; rewrite the header then, with
`Base: b888d66…`.
