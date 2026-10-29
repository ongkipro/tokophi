# Overall review — 2026-10-29

Scope: the whole monorepo at `origin/main` 3403e044 (+ PR #427 deps refresh): tenant/auth boundaries,
dependencies and advisories, build/deploy/CI/ops config, and the task/status documents. Read-only sweep
first, then every finding below was **re-checked against the code by the main session** before it was
written down (agent-only claims are marked). Production was unreachable during the review (OUT-1028),
so nothing here was observed on the live box.

Status legend: ✅ fixed (PR named) · 🔴 P0 · 🟠 P1 · 🟡 P2 · ⚪ owner decision.

---

## A. Fixed during this review

| ID | Finding | Fix | Evidence |
|---|---|---|---|
| R-01 ✅ | **Storefront never received `AUTH_SECRET`** (`docker-compose.coolify.yml`, storefront block). `authSecret()` throws in production; `verifyRecoveryToken` swallows it → every WhatsApp abandoned-cart link opened an EMPTY checkout, nothing logged; storefront chat (`src/lib/chat.ts`) throws. | Forward `AUTH_SECRET` (same value as admin, which mints the links). Guard `test/compose-auth-secret.test.ts` derives the consumer apps from imports. | Guard RED on the old compose (storefront), green after. **Still to verify on production after deploy:** open a recovery link → cart restored. |
| R-02 ✅ | **`updateProfile` changed the login email with a session only.** Email is also the key "Masuk dengan Google" links on → stolen session ⇒ attacker's Gmail linked ⇒ persistent access a password change does not revoke. | Email change needs the current password; refused under impersonation; Google-only (no password) accounts cannot change it. Name-only change unchanged. UI shows "Kata sandi saat ini" only when the email differs. | `apps/admin/lib/actions/account-credentials.test.ts` (real PG) — 5 cases RED on old code, green after; browser: wrong/no password → "Kata sandi saat ini salah.", right one → "Profil diperbarui.". |
| R-03 ✅ | **`setup2FA` switched an ACTIVE 2FA off without a code** (overwrote secret, `totp_enabled=false`) — bypassed `disable2FA`'s check. | Refuses while 2FA is on. | Same test file — RED on old code, green after. |
| R-04 ✅ | sharp < 0.35.5: libvips/libheif/librsvg advisories (HIGH); admin decodes seller uploads, signup is open. | sharp 0.35.5 (admin, docs) — PR #427. | 719 admin tests, real `saveImage`/`saveFavicon` through 0.35.5, builds. |
| R-05 ✅ | Image picker toast said "Melebihi 5MB" while the limit is 2 MB. | Copy fixed. | — |
| R-06 ✅ | Billing-cron test billed other test files' stores (cross-file FK flake); 5 s timeouts under load. | PR #427. | 6 full runs, 0 FK errors. |
| R-07 ✅ | Two stray `</div>` in storefront `Header.astro`. | PR #427. | `astro check` 0 errors with the newer checker. |

## B. Open — security & dependencies

- [ ] **R-10 🔴 Astro 5 → 7 and `@astrojs/node` 9 → ≥11.1.3 (storefront, landing).** Applicable advisories: *"Malformed port in the Host header can crash the Node adapter"* (`@astrojs/node` ≤11.1.2, HIGH) — the storefront resolves every tenant from `Host`, so one request can take every shop down; *"Host header SSRF in prerendered error page fetch"* (astro <6.4.6, HIGH). Checked NOT applicable: `define:vars` breakout — Astro 5.18.2 already escapes `<` as `<` (probed with `</script>`, `</SCRIPT>`, `</script\t>`). Cloudflare in front reduces but does not remove the Host vector (origin reachable by IP — see R-31).
  - **Done when:** `npm audit --omit=dev` shows no astro/@astrojs/node advisory; `astro check` 0; `npm run verify -w @tokophi/storefront` all PASS; checkout driven in a browser end to end (rates → COD → order) with 0 console errors; a request with `Host: x.tokophi.id:99999` returns 4xx and the process stays up.
- [ ] **R-11 🟠 drizzle-orm 0.36 → ≥0.45.2** (SQL injection via improperly escaped identifiers, HIGH). Exposure today is low: the only `sql.raw` is a constant (`apps/storefront/src/pages/api/checkout-session.ts:86`), no user-derived identifiers. Migrations are hand-written, so this is a runtime-only bump. **Done when:** `verify-migrations`, `verify-rls`, `verify-rls-app`, `verify-ledger`, `test:db` green; drizzle-kit not used to generate anything.
- [ ] **R-12 🟡 Google sign-in skips TOTP** (`apps/admin/app/api/auth/google/callback/route.ts` has no TOTP step). ⚪ product decision: require the code after Google for 2FA users, or document that Google's own 2FA stands in.
- [ ] **R-13 🟡 Self-service credential actions log nothing under impersonation** (`lib/actions/security.ts` `changePassword`/`disable2FA`). R-02 refuses the email change under impersonation; decide the same (refuse) for password and 2FA, or write both identities to `platform_activity`.
- [ ] **R-14 🟡 `lib/actions/media.ts:115,128,130` use the owner `db`** instead of `withTenant` (each query filters `storeId`, so no leak — but no RLS net). Move to `withTenant`.
- [ ] **R-15 🟡 Remaining majors:** ESLint 10 (9 is marked unsupported on npm), vitest 5, TypeScript 7, `shadcn` major (low: deepmerge), `@measured/puck` (uuid, moderate — fix is a DOWNGRADE, ignore until puck ships one). Next 16's `middleware` → `proxy` rename (codemod `middleware-to-proxy`; guards and docs name `middleware.ts`).
- [ ] **R-16 🟡 No guard pins "first statement of every mutating action is the gate".** A scan in this review found every admin action gated (directly or via a helper) and every super-admin action behind `platformGate`, but nothing keeps it so. `rbac-census` covers the matrix, not the call sites.

## C. Open — ops, backup, deploy

- [ ] **R-20 🔴 Off-box uptime probe + Vultr balance alert** (root `TASKS.md` 8.1 / 8.2, SLA-DRP §6). Two outages (2026-09-04, 70 h; 2026-10-28) were found by a human. `ops/tokophi-probe.sh` `notify()` is still a stub. Cheapest: an external HTTP monitor on the 5 hosts + `/api/public/ongkir`, Vultr billing alert + auto-pay.
- [ ] **R-21 🟠 Offsite prune can delete every R2 copy when backups stop** (`docker-compose.coolify.yml:695`): `rclone delete --min-age ${R2_RETENTION_DAYS}d` runs after any successful `copy`, and `copy` succeeds with nothing new. 30 days of silent `pg_dump` failure ⇒ zero offsite dumps. **Done when:** the prune is skipped unless the newest local dump is < 8 h old, and the skip is logged.
- [ ] **R-22 🟠 A restore onto a fresh cluster lacks the login roles.** Backup is `pg_dump -d tokophi` (no globals); `tokophi_app` is created by migration 0012 (NOLOGIN), `tokophi_platform` and the login passwords by hand. **Done when:** `pg_dumpall --globals-only` (or a role script without passwords) is in the backup set and SLA-DRP §7 has the step; proved by restoring into an empty cluster.
- [ ] **R-23 🟠 Images run as root, single-stage, `COPY . .` before `npm ci`** (all five Dockerfiles) — every commit reinstalls everything on the VPS; images ~1.7 GB (DEPLOY.md) — the disk-pressure shape of the 2026-07-18 outage. **Done when:** manifests copied first, multi-stage, `USER node`, image size recorded before/after.
- [ ] **R-24 🟠 npm install-script policy is not enforced where it matters** *(agent-tested, not re-run here)*: `node:24-alpine` ships npm 11.19 which runs unapproved `postinstall` with a warning; `packageManager` says npm 11.17; the comment at `.github/workflows/ci.yml:80-90` claims otherwise and names only `unrs-resolver` (lockfile also has esbuild ×6, sharp). **Done when:** one npm version (≥12) pinned in Dockerfiles/CI/`packageManager`, comment corrected.
- [ ] **R-25 🟡 CI before billing returns:** no `permissions:` block in `ci.yml`; actions pinned to tags not SHAs; no `docker build` job (a broken Dockerfile shows up only in Coolify on `main`); lint still skipped.
- [ ] **R-26 🟡 Watchdog gaps** (`ops/tokophi-watchdog.sh`): ignores docs, postgres and cron sidecars; does not heal running-but-unhealthy; cron healthcheck `kill -0 1` proves only the shell.
- [ ] **R-27 🟡 Storefront verify suite default host `toko-demo.test`** exists only in a seeded DB; on the local production copy use `CHECK_BASE_URL=http://batiknusantara.test:4390`. Make the default work on both.
- [ ] **R-28 🟡 `INTEGRATION_TOKEN_KEY` absent from `.env.example`** (BACKLOG.md:1733).
- [ ] R-31 (tracked as 8.8) Coolify panel / origin reachable by IP.

## D. Open — documents (the trackers disagree)

Agent sweep, spot-checked: the trackers contradict each other, so the next agent starts from wrong state.
- [ ] **R-40 🟠 Decide ONE task tracker.** `AGENTS.md` (protocol §1) names `specs/docs/TASKS.md`; `specs/docs/STATUS.md:15` calls it historical and names root `TASKS.md`. Pick one, make the other a pointer.
- [ ] **R-41 🟡 Stale states:** root `TASKS.md:8` header lists tasks that are `[x]` below; Task 8.9 still "BLOCKED" though production moved to the KiriminAja production account 2026-09-17; `OPEN.md:14` vs `:72` (KA IP block); `OPEN.md:75` R2 "UNHEALTHY on purpose" (live since 2026-10-10); `specs/docs/TASKS.md:129,137` vs done 5.12 / 8.32; `REQUIREMENTS.md` marks SEC-15/17/18, F-T8/9/10 and others "NOT MET" though their tasks are `[x]`; `RELEASE.md` describes PR #393; `CHANGELOG.md` stops 2026-09-08; "Task 10.26" (commit `bfc4fa7a`) is in no task doc.
- [ ] **R-42 🟡 Stale counts the guard does not cover:** root `STATUS.md` (109 migrations / 83 tables), `ARCHITECTURE.md` (109), `SYSTEM_MAP.md` (82/106), `SECURITY.md` (81 tables). Extend `packages/db/src/doc-counts.test.ts` to them instead of hand-fixing again.
- [ ] **R-43 🟡 `AGENTS.md` is 156k chars on `main`** — over Claude Code's 150k limit; the split is PR #421 (open).
- [ ] **R-44 🟡 Open items that are actually done** (close them): rich-text editor, template variants (`specs/docs/TASKS.md:68,77`); `BACKLOG.md:1515,1807,1247,1193`.

## E. Genuinely open product work (deduplicated, for planning)

Seller: manual order creation (`/pesanan/baru`), media reorder + "jadikan utama", loading skeletons, Panduan phases (8.37). Super Admin: Meta Health screen (P9b). Shipping/checkout go-live: real payment + booking + cancel (8.34, closes 8.9), `order_id` length (8.21), KA subdistrict ids at vendor (8.17), webhook auth contract (8.15), real sorting code (8.23), courier holidays (N41). Money: COD return economics (5.19, blocked), prepaid shipping-absorption ADR, payment advice reconciliation (8.19). Tracking: consent gating for pixels, live pixel verification (P11). Infra: Cloudflare zone settings (N2), `color_palettes` orphan (N25), `tokophi_app` grants on platform tables (N16), rotate exposed accounts (N29). Owner-blocked: Google OAuth verification (5.20), account scope (5.8).

## Suggested order

1. Deploy #426 → #427 → this PR, one at a time, each watched (merges are serialised); then verify R-01 live.
2. R-20 (owner, ~15 min) — it would have caught both outages.
3. R-10 Astro 7 (own PR, browser-driven checkout).
4. R-21 + R-22 (backup correctness) in one ops PR, proved by a restore into an empty cluster.
5. R-40/R-41 docs consolidation, then R-23/R-24 images, then the rest.
