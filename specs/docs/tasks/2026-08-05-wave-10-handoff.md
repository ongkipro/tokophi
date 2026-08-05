# Wave 10 — handoff (2026-08-05)

Three branches, all cut from `0b10aed` (`docs: OPEN.md — the re-verified open list`, #153), all
committed, **none merged**. Seven entries off `OPEN.md`'s ready-to-pick list are closed.

| branch (worktree) | commits | closes |
|---|---|---|
| `wave10/w10-landing` | `7d31bc2`, `73890fb` | 🔴 **N54** — no way to create a landing page |
| `wave10/w10-superadmin` | `313e893` | **N48**, **N47**, **N35** |
| `wave10/w10-headings` | `139f74e` | **N52**, **N55**, **N56** |

Reasoning is in the commit bodies, not repeated here. This file is what is left to do.

## What was actually driven in a browser

Nothing below is inferred from source. Real Chromium, real Postgres, real dev servers.

- **N52** — `[data-slot="card-title"]` on `/`, `/produk`, `/pesanan`, `/analitik`, `/pengaturan`:
  every rendered title is now `H2`, computed `16px / 500 / 0px margins` (unchanged from the `<div>`).
  `/login` and `/daftar` went from **no `h1` at all** to `H1 24px/500/0px`.
- **N55** — each courier row reads `"jne 0.0% — sehat 0/91"`: a glyph, plus the verdict in text.
- **N56** — `/tema/<id>` with Hero selected: **41 controls, 0 without an accessible name** (was 2).
- **N47** — the owner sees "Reset password" on the other rows and **not on their own**; a `support`
  operator sees **0**; the reset toast reveals the password once and `password_changed_at` moved
  (`08:32:22 → 08:32:26`), i.e. the target's live sessions were revoked.
- **N48** — demoted `owner → support` by SQL with the cookie untouched: Pembayaran/Simpan and
  Kurir/Simpan both raise **"Tidak diizinkan — perlu peran admin, akun ini support."** The page
  stays put (it used to be replaced by Next's English global error) and the console is clean.

**The shared dev DB was left as it was found**: the two `w10-*@probe.test` operators created for
this were deleted, and the role flipped back to `owner` before that. `select email, role from
platform_admins` is back to one row.

## Gates

| | headings | super-admin | landing |
|---|---|---|---|
| `tsc --noEmit` (admin + super) | ✅ | ✅ | — |
| `eslint` (changed files) | ✅ | ✅ | — |
| `vitest` | ✅ 486/486, 55 files | ✅ 25/25 super-admin lib | ✅ 8/8 its two new suites |
| `build:admin` | ✅ | — | — |
| `build:super` | ⚠️ see below | ✅ | — |

⚠️ **`build:super` cannot run in the `w10-headings` worktree** — it has no
`apps/super-admin/.env.local` and dies collecting `/pengaturan` on *"DATABASE_URL is not set"*,
before any wave-10 code is reached (the documented fresh-worktree trap, `OPEN.md` → Traps). Its
super-admin change is one `level={1}` on the login page and `tsc` covers it there. **Run
`build:super` once at integration**, where both branches and both env files meet.

## Left to do

1. **Integrate.** Merge order is not free — all three touch `apps/admin`, and `w10-headings` changes
   `packages/ui/card.tsx`, which **both** apps compile. Suggested: landing → super-admin → headings,
   watching each deploy land before releasing the next (`AGENTS.md`: merges are serialised).
2. **`build:admin` + `build:super` together**, once, on the integrated branch.
3. **Sync the docs.** No branch touches `NEXT.md`/`OPEN.md` on purpose — three streams editing one
   list is a guaranteed conflict. At integration, mark N35, N47, N48, N52, N54, N55, N56 closed in
   `NEXT.md` and drop them from `OPEN.md`'s ready list. **Re-verify before ticking**: that sweep
   found eleven entries claiming to be open that had already shipped.
4. **Re-verify in production** after the deploy, the way waves 8 and 9 were. The one worth driving
   again there is N48: the difference between `next dev` and `next start` was the whole point of
   that measurement, and production is a third build.

## Still open on `OPEN.md`'s ready list

`N38` (label fields · M) · `N33 aftermath` (unfiled, 24 dev products still `1×1×1 cm` · M) ·
`N44` (2 empty states · S) · `N46` (credential sweep skips `packages/` · S) · `N31` (COD fee never
read · S) · `N40` (`v6.1` deprecated · M) · `N41` (seed drift, 3 unchecked · M) · `N13` (sitemap
`lastmod`, blocked on a migration · M). The 🔴 owner-decision list is unchanged.

## One correction to `OPEN.md` this wave earned

Its N35 entry already carried the warning that the env **was** visible on Analitik → Sistem and in
the Test-koneksi result, and that only the connection card lacked it. That was right, and it is why
the fix added `kaEnvName()` as ONE reader instead of a third copy of
`process.env.KIRIMINAJA_ENV ?? "sandbox"`. Three places printing which environment is live is three
places that can disagree.
