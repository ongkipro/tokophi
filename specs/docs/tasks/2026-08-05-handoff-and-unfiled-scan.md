# Handoff 2026-08-05 (evening) — what shipped, what is verified, and what NOBODY has filed

Written against `origin/main` @ `a8c7c05`, which is **also what production is running** (image sha
checked on the box). Read `OPEN.md` first; this file is the delta since it, plus a scan for work that
exists but has no task behind it.

---

## ① Shipped and deployed today — five PRs, all live

| PR | what |
|---|---|
| #154 | `SIGNUP_ENABLED` forwarded into the admin container (it had never reached it) + N33 dimension backfill |
| #155 | `registerStore` was never rate limited — and its cheap "Email sudah terdaftar" answer was an unmetered enumeration oracle |
| #156 | The `session` cookie was never `Secure` — **seven** sites, including both on the control plane |
| #157 | Two `slugify`s that had already drifted, a third in the seed, two check-then-insert races, the name bounds |
| #159 | HSTS enabled on the zone (`max-age=86400; includeSubDomains`) + procedure, rollback, caveats |

**Signup is still CLOSED throughout.** `SIGNUP_ENABLED` is empty in Coolify and the compose default is
empty; `/daftar` renders the closed page with zero `<form>` elements.

---

## ② The repo's own alarms are GREEN — measured, not assumed

This matters because this repo has twice shipped a defect past a verifier that was **already red** and
that everyone had learned to scroll past (`verify-rls`, and the pixel check that demanded three
channels on a one-channel tenant). So: run today, on `a8c7c05`.

| check | result |
|---|---|
| `verify-migrations` | ✅ 90 entries, last `0089_platform_password_revokes_sessions`; stamps increase, idx unique, journal ↔ files match |
| `verify-rls` | ✅ 51/52 store-scoped tables, sole exception `platform_activity` (by design) |
| `verify-ledger` | ✅ 0 orphans across all five child tables, all FKs VALIDATED, both balances fully backed by orders |
| `lint -w @tokophi/super-admin` | ✅ clean |
| `npm test` | ✅ 511/511 (see §④ for the one number that is stale) |

⚠️ **`verify-rls` ran against the LOCAL DEV database**, because that is what `DATABASE_URL` points at.

✅ **`verify-ledger` HAS now been run against PRODUCTION (2026-08-05)** — the first time since the
48-orphan cleanup, i.e. the first time anyone re-checked the thing that had put **Rp810.000** of
withdrawable money behind orders that no longer existed. **All 7 child tables: 0 orphans.** Every FK
VALIDATED, the dangling insert refused today, `available` Rp21.032.562 and `pending` Rp23.424.347
both fully backed by orders. Nothing to act on.

Run where the credential already lives, so it never reaches a shell history or a transcript — the
admin container carries both `DATABASE_URL` and the monorepo source:
`docker exec -w /app/packages/db <admin-container> /app/node_modules/.bin/tsx src/verify-ledger.ts`.

⚠️ **And the word the docs used for it was wrong: it is NOT read-only.** `refusesDanglingInsert`
writes three rows to prove the FK still bites *today* — `convalidated` only says it was checked once.
Both exit paths throw, so the transaction always rolls back; **confirmed on production afterwards**
with `select count(*) from stores where slug like 'fk-probe-%'` → **0**, rather than assumed. Safe,
but an audit of "what writes to production" would have wrongly filtered it out. `AGENTS.md` now says
so.

---

## ③ 🔴 NOBODY HAS FILED THIS: the working copy on this machine is not safe to "just commit"

The instruction that produced this file was "commit and deploy everything local". **I did not**, and
the reason is the finding.

Measured on this machine:

- **26 dirty worktrees** under `.claude/worktrees/`, plus the main checkout.
- **~60 local branches** ahead of `origin/main`.
- **1 entry in the global stash** (`WIP on worktree-super-admin-overhaul`).
- **Local `main` is 30 ahead / 522 behind `origin/main`** and carries 8 uncommitted files.

None of it is mine — my five PRs are merged and their worktrees removed. The dirt is **real source**,
not build noise: `checkout.astro` modified in **7** worktrees, `seed.ts` in 5, `schema.ts` in 4,
`AGENTS.md` in 11.

**The sharp edge is the migration journal.** Five worktrees hold a modified
`packages/db/drizzle/meta/_journal.json`, and every one of them is BEHIND main:

| branch | its last journal entry | `when` |
|---|---|---|
| `worktree-agent-a3993578fbacdbb1c` | `0047_courier_roster_normalise` | 1784019762290 |
| `worktree-agent-ab11e912b75b3586e` | `0048_phone_canonical_62` | 1784106162290 |
| `audit/a4-verify` | `0086_operator_suspension` | 1785406811888 |
| `fix/fix-suspend` | `0086_operator_suspension` | 1785406811888 |
| `work/t-session` | `0087_password_revokes_sessions` | 1785406812888 |
| **`origin/main`** | **`0089_platform_password_revokes_sessions`** | **1785895600000** |

Every one of those stamps is **below** main's. Merging any of them as-is carries a migration that
drizzle applies only if its `when` exceeds the newest stamp already in the target database — so on
production it would be **skipped while printing "migrations applied successfully"**. That is the exact
failure `CLAUDE.md` documents, and it is currently loaded into five branches at once.

**Do not mass-commit or mass-merge these.** What is actually needed is a per-branch triage that only
their authors can do:

- [ ] For each of the ~60 branches: is its content already on `origin/main` under a different SHA
      (squash merge) or is it genuinely unshipped? `git diff origin/main...<branch>` does **not**
      answer this — it diffs from the merge base and shows a squash-merged branch as if it still had
      changes. Compare trees or read the PR list.
- [ ] Delete the branches whose work has shipped. ~60 branches with a stale-fork `main` is how the
      wrong base gets picked.
- [ ] For the 5 journal-carrying worktrees: **renumber AND re-stamp** before any of them goes near a
      PR, and confirm with `select max(created_at) from drizzle.__drizzle_migrations` on the target —
      not by reading the journal.
- [ ] Decide what happens to the stash entry. It belongs to whoever made it; nobody else can tell.
- [ ] `main` on this machine should be reset to `origin/main` **after** its 8 uncommitted files are
      claimed by someone. Never pushed.

---

## ④ Smaller things with no task behind them

- [x] **The documented deploy time was wrong, and the two docs disagreed with each other — FIXED in
      this commit.** `OPEN.md` claimed "~6 minutes, then a 60–90 s window of 503"; `DEPLOY.md:29`
      said "~8–9 min". Measured **four times today**, merge → all four hosts green:
      **524 s · 656 s · 558 s · 542 s**, 503 window ~1,5–2,5 min, sampled every 25 s. `DEPLOY.md` was
      the closer of the two. `OPEN.md` now carries the measured figures and says what it used to
      claim. Recorded here because the number is not cosmetic: the low one is what makes someone
      conclude a healthy deploy has failed and start intervening.
- [x] **`BACKLOG.md`'s ESLint count was stale — CORRECTED.** It claimed "20 remain"; re-measured on
      `1021a11` with `--format json`: **11 errors, 22 warnings**, all in `@tokophi/admin`
      (`super-admin` clean; **`storefront` and `landing` have no `lint` script at all**, which nothing
      had said). Every error is now located to file:line, and two of the entry's own claims had
      inverted: `static-components` is down 12 → 4 and confined to `saldo-client.tsx` alone, and the
      `purity` error it told you to "fix first" — the CLIENT-component `StatusBadge` — **is already
      fixed**, leaving only the two harmless async server components. The entry now carries a
      re-derive command and a warning that a `grep`/`awk` pass mis-attributes files (it pinned an
      error on `lib/data/landing.ts`, which only has an unused-import warning).
- [ ] **`X-Content-Type-Options: nosniff`.** Cloudflare bundles it into the same `security_header`
      object HSTS lives in, so it is one field away (`CLOUDFLARE-PERF.md` §4). Left off deliberately —
      it is a different header and deserves its own decision — but nothing tracks that decision.
- [ ] **The `Secure` flag has never been observed on a real `Set-Cookie`.** The code is verified in
      the running image and `NODE_ENV === "production"` evaluates `true` inside the container, so the
      true branch is live. But no test in this repo can prove it (vitest runs under `NODE_ENV=test`,
      i.e. the false branch) and confirming it needs a successful login. One look at DevTools →
      Application → Cookies closes it.

## ⑤ Still open and already filed — do not re-file

`OPEN.md` is the index; the two that came up today and are correctly recorded there:

- ~~**HSTS `max_age` ramp**~~ ✅ **DONE the same day** — raised 86400 → **31536000** on the owner's
  call, preconditions re-checked immediately before (6 records, all proxied, no MX, no DNS-only).
  🔴 What replaces it is not a task but a standing consequence: **the commitment can no longer be
  withdrawn early.** Disabling the setting stops us sending the header; it does not reach a browser
  that already holds one, which refuses `http://` for up to a year from its last visit. The one live
  decision left is HSTS on merchant **custom hostnames** — same year-long promise, on a domain we do
  not control — and it must be settled before Cloudflare for SaaS is wired
  (`CLOUDFLARE-PERF.md` §4).
- **N2 is NOT unblocked by the HSTS work.** That used `Zone Settings: Edit`, which the token in the
  environment has. N2's two items need **ruleset** permission, which it does not.
- **Email verification before opening signup** — a product decision, not a task. Costed in
  `2026-08-05-signup-open-audit.md` along with two cheaper alternatives.

## ⑥ Ops snapshot (so the next session does not re-measure it)

Box `45.77.33.112`, taken 2026-08-05 evening:

- Disk **57 %** (91 G of 169 G). Docker: 76 images / 47,7 GB, build cache 44,3 GB with 24,7 GB
  reclaimable. **Not a task** — L1b (`/etc/cron.d/tokophi-docker-cleanup`, daily 03:30 UTC) already
  prunes build cache and unused images older than 48 h, and goes aggressive at ≥80 %. It is working.
- Watchdog heartbeat **45 s old** (threshold is 10 min).
- All three cron sidecars up: `cron`, `cron-tracking`, `cron-tracking-events`. Worth checking by name
  after any deploy — `cron-tracking` once sat dead for a week and `awbFilled` stayed at 0.
- Both `migrate` one-shots exited `0`.
- ⚠️ **A second product's stack shares this box** (`jh4u1nj1kef6…`). It shares the disk and the
  cleanup cron. A loose `docker ps | grep -i admin` will match its containers during a swap window —
  match on `^admin-` / `^super-admin-` / `^storefront-` instead.
