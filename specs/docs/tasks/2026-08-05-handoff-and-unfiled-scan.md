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

⚠️ **`verify-rls` and `verify-ledger` ran against the LOCAL DEV database**, because that is what
`DATABASE_URL` points at. `verify-ledger` is documented as safe to run read-only against production
and **has not been re-run there since the 48-orphan cleanup**. Someone with the prod URL should do
that once; it is the check that found Rp810.000 of withdrawable money with no order behind it.

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
- [ ] **`BACKLOG.md`'s ESLint count is stale.** It says "**20 remain**", all React Compiler rules.
      Measured today: **11 errors, 22 warnings** in `@tokophi/admin` (`super-admin` is clean). The
      breakdown has shifted too — 4 × "Cannot create components during render" (BACKLOG says 12),
      5 × "setState synchronously within an effect", 2 × "Cannot call impure function during render".
      Someone has been fixing these without updating the count. Re-derive before quoting it.
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

- **HSTS `max_age` ramp** — currently 86400. Raise to `31536000` after a week (`CLOUDFLARE-PERF.md` §4).
  Until then the protection lapses for anyone who has not visited in 24 h.
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
