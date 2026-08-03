-- A password change must END the sessions that the old password opened. It did not.
--
-- THE FINDING (driven, not reasoned about): logged in as a store owner, `users.password_hash` was
-- rewritten and the browser stayed authenticated on `/produk`. `getSession()` re-reads MEMBERSHIP and
-- ROLE on every request, so a demotion and a removal do take effect immediately — but there was no
-- `password_changed_at`, no token version and no `jti`, so nothing in a 7-day session ever asked
-- whether the credential that minted it still exists. Both incident-response levers were therefore
-- decorative: the merchant's own `/akun/keamanan` change AND super-admin's "Reset password owner"
-- left a stolen cookie fully alive for up to a week. The only working kill switch was deleting the
-- `store_users` row — i.e. removing the owner from their own shop.
--
-- WHY A TRIGGER AND NOT A COLUMN THE CALLERS SET. Six code paths write `users.password_hash`
-- (merchant self-change, super-admin `resetOwnerPassword` + `resetStoreUserPassword` + `addStoreUser`
-- + `createStore`, admin `inviteStoreUser`, self-serve `registerStore`, and the seed). A stamp that
-- five of them remember is WORSE than no stamp at all, because it creates the belief that revocation
-- works — the same shape as the `pct()`/`hashPassword()` drifts already recorded in AGENTS.md, where
-- a rule re-obeyed by hand at every call site was obeyed at two of three. The database is the one
-- place every writer must pass through, and it also covers the two writers that are not code at all:
-- a `psql` UPDATE (exactly how this finding was driven) and any future migration or admin script.
--
-- BEFORE UPDATE ONLY, DELIBERATELY. On INSERT there is no prior credential and no prior session, so
-- there is nothing to revoke and NULL is the honest value — "this hash has never been rotated". That
-- also keeps every freshly-created account (self-serve signup, invite, super-admin store creation)
-- from being signed out by its own creation, which a stamp-on-insert would do: those paths mint a
-- session in the same second they write the hash, and the same-second tie-break resolves to REVOKED.
--
-- NULL = the session survives. Sessions already in the wild predate this column, and a deploy that
-- signs out every logged-in merchant is not a change anyone chose. The gap this leaves is bounded and
-- self-closing: a password rotated BEFORE this migration does not revoke a session minted before it,
-- and the first rotation after deploy closes it for that user permanently. If the owner would rather
-- have the clean break, the one-line alternative is documented in the report, not shipped here.
--
-- Idempotent (see CLAUDE.md): drizzle applies the whole pending batch in ONE transaction, so a bare
-- `add column` / `create trigger` that already exists rolls back every migration behind it, silently.
alter table "users" add column if not exists "password_changed_at" timestamp with time zone;

create or replace function stamp_password_changed_at() returns trigger as $$
begin
  -- `is distinct from` (not `<>`) so NULL→hash and hash→NULL both count. Neither has a code path
  -- today; both are credential changes, and the safe direction for a security control is to revoke.
  if new.password_hash is distinct from old.password_hash then
    new.password_changed_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_stamp_password_changed_at on "users";
create trigger users_stamp_password_changed_at
  before update on "users"
  for each row execute function stamp_password_changed_at();
