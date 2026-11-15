# Migrations — numbering, idempotency, stamps, hand-written

> Moved **verbatim** from `AGENTS.md` on 2026-10-28 (Claude Code warns when `AGENTS.md` exceeds 150k chars, and it is
> loaded in full into every session). `AGENTS.md` keeps a short digest of the rules plus a pointer here; this file keeps
> the reasoning and the incident history. Words like "above"/"below"/"the next section" refer to the old single-file
> layout — follow the named file or section instead. **If this file and the code disagree, the code wins — fix this file.**

## Migration numbers (shared worktree)

- **Migration numbers.** Two branches open at once BOTH write `0064_*`, because each one only looked
  at its own journal. On 2026-07-22 that happened: `feat/cetak-resi-demo` landed `0064`–`0069` while
  this branch was open with its own `0064`, and the folder drizzle orders by ended up with two.
  **`git fetch && cat origin/main:packages/db/drizzle/meta/_journal.json | tail` BEFORE you generate
  one**, and **`npm run verify-migrations -w @tokophi/db`** after — it fails on a duplicate index, on
  a `when` that does not increase, and on a journal entry with no `.sql` file (or the reverse).
  Resolving the journal conflict: take **main's file whole** and append your one entry. Never
  hand-merge the list — it rewrites entries that belong to someone else.
  ⚠️ **WRITE EVERY MIGRATION IDEMPOTENT** — `add column if not exists`, `create index if not exists`,
  and `do $$ begin create type … exception when duplicate_object then null; end $$` for enums. Drizzle
  applies the whole pending batch in **ONE transaction**: a single "already exists" rolls back every
  migration behind it, and prints nothing you would notice. On 2026-07-30 that left **16 migrations
  unapplied** on the shared dev DB — `0062` aborted on a column that had arrived earlier via `push`, so
  `0063`–`0083` never ran, for everyone. Mixing `push` and `migrate` on one database is how the
  divergence starts; idempotency is what makes it survivable.
  - 🔴 **AND A STAMP THAT IS TOO HIGH SKIPS SOMEBODY ELSE'S MIGRATION, SILENTLY.** Drizzle applies only
    entries whose `when` exceeds the newest stamp already recorded in the target database — so the
    danger is not just a duplicate `idx`, it is a stamp that JUMPS. Live example, 2026-08-05: the
    shared dev DB's newest applied stamp was **1785774399036**, which came from `ka/flow-audit` — an
    **unmerged** branch, whose migration is ALSO numbered `0087` and therefore collides with main's
    `0087_password_revokes_sessions` (stamped 1785774**06**812888, i.e. lower). Wave 7's `0088` had to be
    stamped **above** the dev DB's newest (1785774400000) or the column would never arrive locally and
    `getPlatformSession` would throw → **every operator locked out of the control plane**.
    ⚠️ **The cost is paid by whoever merges SECOND.** Once wave 7 is on production, production's newest
    stamp is 1785774400000, so a later merge carrying 1785774399036 is **skipped while printing
    "migrations applied successfully"**. `verify-migrations` catches the duplicate `0087` **index**, so
    the collision cannot ship unnoticed — but renumbering to `0089` is only half the fix. **RE-STAMP as
    well as renumber**, and confirm with `select max(created_at) from drizzle.__drizzle_migrations` on
    the target, not by reading the journal.
    ⚠️ **A migration applied to the shared dev DB from an unmerged branch is the root cause here.**
    It makes every other open branch choose between "works locally" and "works on production". Prefer
    not to `migrate` a branch's own migration into the shared container until it is close to merging.

## Migrations are written by hand — never `npm run generate`

- 🔴 **MIGRATIONS HERE ARE WRITTEN BY HAND. `npm run generate` PRODUCES ONE THAT ABORTS THE WHOLE
  PENDING BATCH.** The drizzle meta snapshots stop at **`0095`**, so `generate` diffs the schema
  against a stale snapshot and replays work that already shipped. Measured 2026-09-10 while writing
  `0108`: it re-created `impersonation_grants`, `platform_finance` and `rate_limit_counters`,
  re-added five columns, **and emitted `ALTER TYPE "store_user_role" ADD VALUE 'advertiser'`, which
  has no `IF NOT EXISTS` form** — on any database that already has that value the statement errors,
  and because drizzle applies the pending batch in ONE transaction it takes every migration behind
  it down with it, while printing "migrations applied successfully". That is the same failure that
  left 16 migrations unapplied on the shared dev DB on 2026-07-30.
  **Copy a recent hand-written migration** (`0107`, `0108`) for the shape — idempotent statements,
  a `comment on column` explaining the column, the reasoning in a header comment — append the entry
  to `_journal.json` yourself with a stamp ABOVE the newest, and run
  `npm run verify-migrations -w @tokophi/db`.
