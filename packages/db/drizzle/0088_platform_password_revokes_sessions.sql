-- The CONTROL PLANE half of 0087. Rotating a platform operator's password must end the sessions
-- that password opened — and until this migration there was no way to rotate one at all.
--
-- THE FINDING (driven against a live server, 2026-08-03, one operator cookie held constant while the
-- `platform_admins` row was mutated by SQL):
--
--   role owner → support   → the session still minted a NEW platform operator (an owner-gated act)
--   password_hash rewritten → same
--   the row DELETED         → same
--
-- `getPlatformSession()` decoded the 7-day JWT and returned the claims verbatim; nothing ever re-read
-- `platform_admins`. The merchant side has re-read `store_users` on every request since day one,
-- which is exactly why deleting a membership logs a merchant out. The surface that reaches EVERY
-- tenant was the weaker of the two.
--
-- The re-read (this branch's `resolvePlatformSession`) buys back demotion and deletion on its own.
-- This column buys back the third row of that table, and it is the one the incident needs: the
-- super-admin password in use was exposed in a chat transcript, so "rotate it" has to mean "and
-- evict whoever already logged in with it", not "and they keep their cookie for six more days".
--
-- ⚠️ THE TRIGGER FUNCTION IS 0087's, DELIBERATELY NOT A SECOND COPY. `stamp_password_changed_at()`
-- reads `new.password_hash`/`old.password_hash`, which is what this table calls the column too, so it
-- applies unchanged. Two copies of a security rule is the shape this repo has been bitten by twice
-- (two password mints, one of them 24 bits; five copies of `hashPassword`) — a copy is how the weaker
-- half survives a fix. 0087 always runs first (journal order, and drizzle applies the batch in one
-- transaction), so the function exists by the time this statement needs it.
--
-- BEFORE UPDATE ONLY, and NULL = the session survives — both for the reasons written out in 0087:
-- an INSERT has no prior credential and no prior session to revoke, and a deploy that signs out every
-- logged-in operator is not a change anyone chose.
--
-- ⚠️ THE `when` STAMP IS DELIBERATELY HIGH (1785774400000), NOT origin/main's head + 1000.
-- origin/main ends at 0087 = 1785406812888, but another open branch has already applied a migration
-- stamped 1785774399036 to the shared dev AND test databases — and drizzle applies only entries whose
-- `when` is GREATER than the newest one the target already holds, while printing "applied
-- successfully" either way. Following the ladder would therefore have shipped a migration that is
-- silently skipped the moment that branch lands first, and the failure mode is not cosmetic: without
-- this column `getPlatformSession()` throws on every request, fails closed, and locks every operator
-- out of the control plane with no way back in. Whoever merges SECOND has to re-stamp; the higher
-- number moves that obligation to the branch that can still be renumbered.
--
-- Idempotent (see CLAUDE.md): drizzle applies the whole pending batch in ONE transaction, so a bare
-- `add column` / `create trigger` that already exists rolls back every migration behind it, silently.
alter table "platform_admins" add column if not exists "password_changed_at" timestamp with time zone;

drop trigger if exists platform_admins_stamp_password_changed_at on "platform_admins";
create trigger platform_admins_stamp_password_changed_at
  before update on "platform_admins"
  for each row execute function stamp_password_changed_at();
