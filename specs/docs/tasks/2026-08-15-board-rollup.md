# Board rollup — 2026-08-15: three quiet days on main, ONE loud fact about production

**Written 2026-08-15, measured against origin/main @ `b61f870` and the live box.** This
consolidates both 2026-08-12 session closes (`…-session-close.md` + `…-session-close-b.md` = the
N-queue sweep session; `…-session-close-slug-theme.md` = the slug/theme/audit session) and
everything observable since. Read those three for detail; this file is the index plus the NEW facts.

## 🔴 THE FACT THAT MATTERS: production runs a commit that is on NO branch

Measured today: all three app containers run image tag **`3785a36`** — a commit whose parent is
main's tip `b61f870` but which main does not contain. GitHub's activity log explains it:

| 2026-08-14 (UTC) | event |
|---|---|
| 17:31 | branches created: `docs/irwansyah-order-finance-task`, `fix/landing-trust-strip` |
| 17:32 | **push to `main`**: `b61f870 → 3785a36` ("feat(tokophi): update landing components, ops scripts, and specs") |
| 17:37 | **force-push `main` BACK**: `3785a36 → b61f870` — the push was deliberately undone 5 minutes later |
| 17:39 | four more branches force-pushed in one sweep (`fix/ux3-login-verify`, `docs/spec-completion`, `dev/rich-local`, `feature/buyer-account-local`) — a re-arrangement, same operator |

**Coolify built and deployed inside that 5-minute window**, so the revert moved main but not the
fleet. Since then main has been md-quiet, so nothing has rebuilt — production has been running the
reverted commit for ~3 days.

- **The commit is SAFE now**: recovered today as branch **`recover/prod-20260814`**
  (`3785a362569b…`, created via the GitHub API — additive, main untouched). Before that it was
  reachable by sha only, one GC away from being unrecoverable.
- **The drift is bounded** (diff vs main, 15 files, +359/−219): `apps/landing` index page +
  styles, `ops/tokophi-probe.sh` + a NEW `ops/tokophi-docker-cleanup.test.sh`, and specs
  (`README.md`, `DEPLOY.md`, `OPEN.md` — ⚠️ the OPEN.md/README hunks look like the same stale
  board-refresh the headless branch carried, which may be exactly why it was pulled back).
  **Seller admin / super-admin / storefront app code is unchanged** — no behavioural drift on the
  money paths.
- **⚠️ Standing hazard until decided:** the NEXT code merge to main will rebuild from `b61f870`
  lineage and silently revert production's landing/ops changes. That is fine if the 17:37
  force-push meant "discard"; it is a loss if it meant "not yet".

**Owner decision needed (either is one command):**
1. **Honor the revert** — trigger a redeploy from main; prod returns to the code every session can
   see. `recover/prod-20260814` stays as the archive of what was discarded.
2. **Re-adopt the work** — review `recover/prod-20260814` (strip the stale OPEN.md/README hunks,
   keep landing + ops), merge properly via PR; prod and main reconverge forward.

## What the three days contained (already recorded, indexed here)

- **N-queue sweep session** (13 PRs #253–#260, #264, #267–#269, #271): the no-decision queue
  emptied; two owner-approved prod writes executed + attributed; courier-intent + N29 forensics;
  N40 contract verdict (v6.2 renames nothing — one-line migrate, phase-2 awaits one verification
  booking); the downgrade-trap cleanup script committed; two self-made incidents recovered with
  disclosure.
- **Slug/theme session** (6 PRs #261–#263, #265–#266, #270 + #272/#273 order-finance): demo slug →
  `batiknusantara` (with the freed-slug F1 fix), platform theme holder + decision-B fallback, the
  9-minute 503 incident (STORE_SLUG env ↔ healthcheck coupling — permanent fix via Coolify's ORM),
  DB-parity screening. Owner decisions recorded: demo store stays `batiknusantara`; HSTS raise
  filed time-gated.
- **After both closes**: `#274`/`#275` (the closes themselves) — then nothing on main until the
  14-Aug push/revert above.

## Branch inventory worth knowing (2026-08-15)

- `recover/prod-20260814` — **NEW today**, the code production actually runs. Decision above.
- `docs/n40-v62-contract` — N40 verdict + fixtures, unmerged by design; feeds phase-2.
- `docs/irwansyah-order-finance-task`, `fix/landing-trust-strip` — created 14-Aug minutes before
  the push; unreviewed here.
- `fix/ux3-login-verify`, `docs/spec-completion`, `dev/rich-local`, `feature/buyer-account-local` —
  force-rearranged 14-Aug 17:39; other streams' territory.
- `docs/local-task-headless-20260811` — still unmerged; its two good files were salvaged (#269),
  its board analysis remains superseded. Candidate for deletion by its owner.
- Long-open PRs #202 (deliberately not-for-merge) & #158 — unchanged.

## The board (unchanged from close B, plus the new item on top)

1. **🔴 NEW: the prod-vs-main decision above** — cheapest to settle before the next code merge
   settles it silently.
2. **N40 fase-2** — one-line bump + ONE sandbox verification booking; awaiting owner permission.
3. **Owner keys**: R2 token (DR-1 — backups still local-only) · `demo@tokophi.com`/impersonation
   credential (SEC-4 + dashboard profiling).
4. **Owner decisions**: N57 signup-notification transport · N58 mailer · parcel-size vs quantity ·
   N1 impersonation ADR · N16 `tokophi_app` DML · dev-DB debris (N25 + orphan columns + 7 stray
   stamps) · N28 crawl · demo picked-set `idx:00`/`jtcargo:REG` · `eslint-plugin-astro` devDep ·
   narrow CF SaaS token · HSTS raise (skipped on instruction, reopenable) · N29 §① double-check of
   the two seed-epoch accounts.
5. **External (KiriminAja support)**: webhook registration path (N39) · `libur` schedule endpoint.
