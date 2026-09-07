# OPEN — current development handoff

**Re-verified 2026-09-07 against the code, `BUILD-LOG.md` and production (branch `feat/sweep-0907`).**
Previous refresh: 2026-08-16 (consolidated pre-release audit) — that version's "13 P0 release
blockers" had been false since 2026-08-22, and it dropped the N36–N43 disambiguation table that
`AGENTS.md` promises lives here. Both are corrected below.

This file is a navigation handoff. It is not a second task board.

## 🔴 Open from production — 2026-09-07

Both surfaced by the incident in `BUILD-LOG.md` 2026-09-07 11:53 UTC. Neither is fixable in code.

1. **KiriminAja sandbox refuses the VPS IP.** `tdev.kiriminaja.com /api/mitra/province` →
   `401 "Your IP address 45.77.33.112 were not allowed to access this API"` (probed from inside the
   admin container, key never printed, `KIRIMINAJA_ENV=sandbox`). So `op:"rates"` answers
   `SHIPPING_QUOTE_UNAVAILABLE` → **no ongkir → no COD → no order can be placed**, while kecamatan
   search, kelurahan and kodepos keep working (local tables) — the checkout LOOKS alive. The IP is
   unchanged since provisioning; the allow-list entry lapsed or was removed on the vendor side.
   **Owner action:** re-add `45.77.33.112` at the KiriminAja developer sandbox dashboard, then
   Super Admin → Pengaturan → "Tes koneksi KiriminAja" (`kaTestConnection`, hits `province`, free).
   Do NOT run the AutoLaris test — it creates a real Rp10.000 QRIS bill. Code follow-on: N35's
   2026-09-07 addendum in [`NEXT.md`](./NEXT.md) (surface an upstream REFUSAL, not just the env name).
2. **The VPS `volumdev` was suspended for billing ~70 h and nothing alerted anyone.** Off
   2026-09-04 20:27 WIB → 2026-09-07 18:47 WIB (`journalctl --list-boots`); every `tokophi.com` host
   answered Cloudflare 522; found only because a merchant reported "cannot search kecamatan".
   Balance $9.35 vs $10.36 pending; the promo credit expired 2026-08-20. 0 orders lost (last order
   2026-08-26) but none possible. Every internal signal — `cron_runs`, `health/env`, backups, the
   Analitik → Sistem card — died with the box, by construction. **Open: external uptime monitoring
   on the four hosts + a Vultr balance/invoice alert to the owner.** Owner-side; no repo change.

## Current status

- Unrestricted production release is still blocked; **Stage 7 (release gate) has never been run.**
- Repository-root [`TASKS.md`](../../../TASKS.md) is the only active queue and release gate. Counted
  2026-09-07 from its `Status:` lines: **Stage 4 P0 — 13/13 DONE** (last one 2026-08-22).
  **Stage 5 P1 — 12 open:** 5.1, 5.4, 5.6, 5.7, 5.8\*, 5.12\*, 5.13, 5.14, 5.15, 5.18, 5.19\*, 5.20\*.
  **Stage 6 P2 — 6 open:** 6.1, 6.3, 6.4, 6.6, 6.7, 6.8. (\* = owner-gated: an account-scope
  decision, CI on a private repo, written KiriminAja confirmation, real Google OAuth credentials.)
- The epic-level map [`../TASKS.md`](../TASKS.md) was re-verified 1:1 against the code on
  2026-09-07 (22 items flipped, Epic 8 added for work shipped since 2026-08-24).
- TokoΦ Account is accepted as a product direction, not as deployed behavior (Task 5.8).
- Production mutation, deployment, credential rotation, and infrastructure changes remain owner-gated.
- **CI is inert**: `.github/workflows/ci.yml` exists and caught a real bug on 2026-08-27, but the
  repo went PRIVATE again on 2026-08-28 by owner order (`gh api` → `private`, 2026-09-07). Task 5.12.

## Shipped since the 2026-08-16 refresh — do not re-file

All in `BUILD-LOG.md` under the date. Finance overhaul FIN-01/02/03 + fee schedule enforced in
checkout (2026-08-24) · KiriminAja UAT pack: hint-only AWB webhook + 9-scenario sim, AutoLaris Create
Order `submit` (2026-08-24) · Advertiser + Customer Service roles (2026-08-24) · thanks page driven
with a REAL payment (2026-08-26) · ads precision, `value` = goods only (2026-08-26) · zero-downtime
deploy 81–115 s → 7–8 s (2026-08-28) · full audit: OVO switched OFF in prod, `expiryStamp` pinned to
WIB (2026-08-31) · Task 5.19 honest-label half + seed COD finance (2026-08-31) · offsite backup
sidecar to R2, proved against a real S3 endpoint, **inert until the owner mints an account-scoped R2
token and a restore is exercised once** (2026-09-02) · generated page map + 35-finding route sweep,
2 🔴 still open (AD-3 `BN` initials, SF-1 feed origin) (2026-09-04) · Log Sistem + SA-1/SA-2/SA-4
(2026-09-04).

## 🔴 Waiting on the owner (re-verified 2026-09-07)

| | what is actually being asked |
|---|---|
| **KiriminAja allow-list** | above, item 1. Blocks every order today. |
| **Uptime + billing alert** | above, item 2. |
| **KiriminAja production cutover** | `KIRIMINAJA_ENV=sandbox` in production (AUDIT-FULL 2026-08-31 ③); the UAT sheet from 2026-08-24 is still unsent, so there is no production key. Same contract both sides (owner ruling 2026-08-03) — an endpoint swap, nothing else. |
| **R2 credential + restore drill** | `backup-offsite` is deployed and UNHEALTHY on purpose. Needs a Cloudflare token with **R2 Storage: Edit** (both existing tokens are zone-scoped) and one restore-from-R2 into a throwaway DB (`DEPLOY.md` runbook). Until then the only backups sit on the box that was just suspended for 70 h. |
| **Coolify panel + origin exposure** | AUDIT-FULL ①②: `:8000/6001/6002/8080` answer from the public internet and `:443` by IP bypasses Cloudflare. Decision: IP allow-list vs SSH tunnel. |
| **N29 — rotate the exposed accounts** | Runbook `2026-08-03-rotate-exposed-owners.md` still reads *"WRITTEN, NOT EXECUTED"*; a 2026-08-23 BUILD-LOG line says the seeded platform passwords "were rotated (N29)". **Contradiction — not verifiable without production access; re-measure principals before trusting either.** |
| **N2 — two Cloudflare zone settings** | Still ON: `toko.tokophi.com` served 4 `email-decode`/`email-protection` hits on 2026-09-07. Procedure in `CLOUDFLARE-PERF.md` §1–§2; needs a token with ruleset permission. |
| **N16 — `tokophi_app` DML on platform tables** | Unchanged: `0012_tenant_rls.sql` grants remain, no `REVOKE` in 0000–0105. Architecture decision before any PostgREST cutover. |
| **Prepaid shipping absorption** | ADR 0014 settled COD; prepaid runs the same shape and is undecided (figure on Super Admin → Analitik reads *"belum diputuskan"*). Needs its own ADR. |
| **N25 — `color_palettes` orphan** | Still in no `schema.ts` entry and no migration; `SCHEMA.md:133` still lists it from the dev container. Drop on the shared container = destructive, owner call. |
| **Zero-downtime → absolute zero** | Three structural options recorded in BUILD-LOG 2026-08-28 ⑤; none executed without an order. |

## ⚠️ `NEXT.md` has EIGHT duplicated numbers — always quote the TITLE

The doc sweep (#146) and audit wave 7 (#148) both numbered from N36. #146 landed first, so the numbers
are its; wave 7 reused them. **Nothing has been renumbered** — renaming another stream's live entries
mid-flight is how two people work the same id from opposite ends. Wave-7 headings carry a `(wave 7)`
suffix where they were rewritten; the rest you disambiguate by title. Statuses re-verified 2026-09-07.

| id | #146 — shipping / KiriminAja | #148 — audit wave 7 |
|---|---|---|
| N36 | Five status codes unmapped ✅ | Tenant from the BODY ❌ refuted |
| N37 | `pickup_number` + VA/COD ✅ | Body-size / array caps ✅ |
| N38 | **Label missing required fields** 🟡 plumbing ✅ 2026-08-12; **insurance column + sorting code still open** | Provider error text ✅ |
| N39 | **Webhooks** 🟡 receiver SHIPPED 2026-08-24 (`api/public/kiriminaja/webhook`, hint-only, verified pull); registration on the vendor side not recorded | Money tests skipped in a worktree ✅ |
| N40 | `v6.1` → **v6.2 MIGRATED 2026-08-20** ✅ | `NaN` in an SVG path ✅ |
| N41 | **Courier holidays (`libur`)** 🟠 still no code (0 matches) | Seed drift 🟡 all 5 measured 2026-08-12; 2 backfills await approval |
| N42 | COD settlement ✅ (ADR 0014) | `SEED_FORCE=1` destroys config ✅ (`seed-guard.ts`, #150) |
| N43 | flake ✅ (was never real) | Defects only in a commit body ✅ |

(`N18a`/`N18b` look like a collision to a naive grep. They are not.)

## Start here

1. Read [`../AUDIT-SUMMARY.md`](../AUDIT-SUMMARY.md) for current evidence, limitations, and release gates.
2. Read [`../REQUIREMENTS.md`](../REQUIREMENTS.md) for accepted behavior and current `NOT MET` or `PARTIAL` status.
3. Execute root [`TASKS.md`](../../../TASKS.md) in its stated dependency order and parallel-lane contract.
4. Run Stage 7 only after Stages 4–6 are integrated.
5. Update requirement status, audit evidence, status, and release language only from executable proof.

If documents disagree, use this order:

1. Executable code, migrations, tests, and observed runtime evidence.
2. Accepted ADRs and the canonical domain owner named in [`../DEVELOPMENT_READINESS.md`](../DEVELOPMENT_READINESS.md).
3. [`../REQUIREMENTS.md`](../REQUIREMENTS.md), [`../AUDIT-SUMMARY.md`](../AUDIT-SUMMARY.md), and root [`TASKS.md`](../../../TASKS.md).
4. Dated audits, handoffs, worklogs, and historical task ledgers.

Never promote a dated observation into current behavior without rerunning its check.

## Active contracts

- Implemented architecture: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- Deployment and production safety: [`../DEPLOY.md`](../DEPLOY.md)
- Security posture: [`../SECURITY.md`](../SECURITY.md)
- Data model: [`../DATA_MODEL.md`](../DATA_MODEL.md)
- Observability and operations: [`../OBSERVABILITY.md`](../OBSERVABILITY.md)
- Privacy and compliance engineering: [`../PRIVACY-COMPLIANCE.md`](../PRIVACY-COMPLIANCE.md)
- Money map: [`../FINANCE.md`](../FINANCE.md)
- Every route → file → data/actions → gate → tests: [`../PAGE_MAP.md`](../PAGE_MAP.md) (generated)
- Proposed TokoΦ Account behavior: [`../TOKOPHI_ACCOUNT_SPEC.md`](../TOKOPHI_ACCOUNT_SPEC.md)
- Proposed headless storefront behavior: [`../HEADLESS_STOREFRONT_SPEC.md`](../HEADLESS_STOREFRONT_SPEC.md)

## Historical evidence

The following files remain useful for incident detail and decision history, but do not own current work:

- [`NEXT.md`](./NEXT.md): long-form historical queue with duplicate identifiers and stale-state warnings — its open/closed marks were re-verified 2026-09-07 (N1, N28, N35, N40, N42 (wave 7), N44, N46, N47, N48, N59–N63 closed with pointers; N2, N16, N25, N29, N38, N39, N41, N56, N57, N58 still open).
- [`../BACKLOG.md`](../BACKLOG.md): historical priority ledger.
- [`../WORKLOG.md`](../WORKLOG.md): chronological implementation record.
- [`2026-09-03-resume-checklist.md`](./2026-09-03-resume-checklist.md): the owner's and engineering queues frozen before the 2026-09-03 restart.
- Dated files in this directory: session handoffs, audit waves, production measurements, and closed implementation contracts.

When a historical entry is still relevant, trace it to a current requirement and root task before changing code. Do not reopen or implement work solely because an old checkbox remains open.
