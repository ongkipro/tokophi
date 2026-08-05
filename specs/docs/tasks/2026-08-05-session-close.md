# Session close — 2026-08-05

Everything below was merged AND deployed on the day; every figure was measured, not inferred. This is
the ledger and the end state. For reasoning, go to the two documents it links; do not re-derive it
here.

- **Reasoning for the signup stream** → [`2026-08-05-signup-open-audit.md`](./2026-08-05-signup-open-audit.md)
- **The scan, the repo-hygiene finding, the ops snapshot** → [`2026-08-05-handoff-and-unfiled-scan.md`](./2026-08-05-handoff-and-unfiled-scan.md)
- **The zone settings** → [`../CLOUDFLARE-PERF.md`](../CLOUDFLARE-PERF.md) §4

---

## What shipped

Nine PRs. ⚠️ **#158 is NOT in this stream** — it is someone else's, still OPEN, and the numbering gap
is not a mistake.

| PR | merge | what it actually was |
|---|---|---|
| #154 | `1bde32e` | `SIGNUP_ENABLED` had **never reached the admin container** — set in Coolify, dropped by compose. Plus the N33 dimension backfill |
| #155 | `57f0826` | `registerStore` was never rate limited. The expensive half is 7 rows in one txn; the half that matters is the **cheap** one — "Email sudah terdaftar" answered before any write, i.e. an unmetered enumeration oracle over every merchant |
| #156 | `bc4f185` | The `session` cookie was never `Secure` — **seven** sites, filed as five, and the two that were missed were **both on the control plane** |
| #157 | `bfbc811` | Two `slugify`s that had already drifted (`"Café Senja"` → `cafe-senja` vs `caf-senja`), **a third found in the seed by scanning the sink**, two check-then-insert races, the name bounds |
| #159 | `a8c7c05` | HSTS enabled on the zone |
| #160 | `1021a11` | Handoff + the reason "commit everything local" was refused |
| #161 | `55c425b` | `BACKLOG`'s ESLint count said 20; it is **11** — and two of that entry's own claims had inverted |
| #162 | `e536baa` | HSTS `max-age` 86400 → **31536000** |
| #163 | `cb7c864` | `verify-ledger` run against **production**; and the check is **not** read-only, which the docs claimed |

Two changes are **not in git** because they are zone settings — both recorded in `CLOUDFLARE-PERF.md` §4:
HSTS enabled, then raised to a year.

---

## End state — verified, not assumed

| | |
|---|---|
| production = `origin/main` | admin, super-admin and storefront all on the same image sha, checked on the box after every deploy |
| HSTS | `max-age=31536000; includeSubDomains` on **all six** hosts including a tenant subdomain · `preload` **off** |
| session cookie | `Secure` in all seven writers; `NODE_ENV==="production"` evaluates `true` **inside the running container** |
| signup | **CLOSED.** `/daftar` serves the explanation page with **zero `<form>` elements** |
| `verify-migrations` | ✅ 90 entries, journal sane |
| `verify-rls` | ✅ 51/52, sole exception `platform_activity` (dev DB) |
| `verify-ledger` | ✅ **on PRODUCTION** — 7 child tables, 0 orphans, both balances backed by orders |
| `npm test` | ✅ 511/511 |
| lint | admin **11 errors / 22 warnings** · super-admin clean · storefront + landing have **no lint script** |

---

## 🔴 Two things that are now facts about the product, not settings

1. **HSTS cannot be withdrawn early.** Disabling it stops us *sending* the header; it does not reach a
   browser that already holds one, which refuses `http://` for this domain and every subdomain for up
   to **a year from its last visit**. Correct here — the zone is Cloudflare-proxied end to end — but
   no longer a knob.
2. **The open decision that inherits it: HSTS on merchant CUSTOM HOSTNAMES.** The moment Cloudflare
   for SaaS is wired, the same year-long promise is emitted on a domain **we do not control**, with
   `includeSubDomains`. Settle it *before* wiring, not after. At 86400 it was a footnote; at a year it
   is the largest open consequence of the setting.

## What is left, and who it belongs to

- **Email verification before opening signup** — a product decision, not a task. Signup would create
  real tenants for unverified addresses; there is no mailer in this repo. Two cheaper alternatives are
  costed in the audit doc.
- **The working copy on this machine.** 26 dirty worktrees, ~60 local branches, a global stash entry,
  `main` 30 ahead / 522 behind. **Five worktrees hold a migration journal stamped BELOW main's** — the
  "applied successfully" silent skip. Per-branch triage only the authors can do; the checklist is in
  the handoff.
- **N2** (two Cloudflare zone items) — still blocked on a token with **ruleset** permission. The HSTS
  work used `Zone Settings: Edit`, a different one, and did **not** unblock it.
- **11 ESLint errors** — owned by features other agents are iterating on. The durable fix is wiring
  lint into the deploy path and giving storefront/landing a `lint` script.
- **`X-Content-Type-Options: nosniff`** — one field away in the same Cloudflare object as HSTS. Left
  off deliberately; it is a different header and deserves its own decision.
- **The `Secure` flag on a real `Set-Cookie`** — the only claim today that rests on the code and the
  container's environment rather than on an observation. No test here *can* prove it (vitest runs
  `NODE_ENV=test`, the false branch). One login and a look at DevTools closes it.

## Three habits this session paid for — worth keeping

- **Read the script before pointing a tool at production.** `verify-ledger` is documented "read-only";
  it writes three rows inside an always-aborting transaction. Safe, but the sentence was wrong, and an
  audit trusting it would have filtered the check out.
- **Confirm the rollback, don't assume it.** After the production run:
  `select count(*) from stores where slug like 'fk-probe-%'` → 0.
- **`--format json`, never `grep`.** The first ESLint census mis-attributed an error to
  `lib/data/landing.ts`, which carries only an unused-import warning. The correction would have
  shipped its own wrong data.
