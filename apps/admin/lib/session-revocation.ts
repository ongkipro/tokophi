/**
 * Does this session still outlive the credential that minted it?
 *
 * Pure, no DB, no `server-only` — so the one rule that decides whether a stolen cookie still works
 * can actually be tested. (Same split as `platform-rank.ts` and `@tokophi/lib/password`: the security
 * rule that lives inside a module which pulls `@tokophi/db` at import scope is the rule that has no
 * test, which is exactly how the super-admin rank gate went two years ungated.)
 *
 * `getSession()` is the only caller. See `apps/admin/lib/auth.ts` and migration 0087.
 */

/**
 * @param iat   the JWT's `iat` claim, in WHOLE SECONDS (what `SignJWT.setIssuedAt()` writes).
 * @param passwordChangedAt  `users.password_changed_at`, or null.
 * @returns true = the session stands; false = the credential was rotated after it was minted.
 */
export function sessionOutlivesPassword(iat: number | undefined, passwordChangedAt: Date | null | undefined): boolean {
  // Never rotated, or the row predates migration 0087. Nothing to revoke — and this is the branch
  // that keeps today's logged-in merchants logged in through the deploy that adds the column.
  if (!passwordChangedAt) return true;

  // Every token this app mints carries `iat` (`signSession` calls `setIssuedAt()`), so a token
  // without one is not ours and cannot prove it is newer than the rotation. Fail closed — the same
  // rule `getSession()` already applies to a database blip.
  if (typeof iat !== "number" || !Number.isFinite(iat)) return false;

  // ⚠️ THE SAME-SECOND TIE-BREAK, AND WHY IT RESOLVES TO *REVOKED*.
  // `iat` has one-second resolution; `password_changed_at` is a microsecond timestamp. A token minted
  // in the same second as a rotation is genuinely ambiguous — it may have been signed 400 ms before
  // the UPDATE or 400 ms after, and the token cannot tell us which. Strictly-greater resolves that
  // ambiguity toward INVALIDATING, because the two errors are not the same size: a false SURVIVAL is
  // the entire defect this migration exists to close (an attacker's cookie living on past the reset
  // that was meant to kill it), while a false REVOCATION costs one extra login and is self-healing.
  //
  // Who actually pays it: only a session minted within the same wall-clock second as the rotation.
  // `signIn` cannot hit it (a human has to be handed the new password first) and `registerStore`
  // cannot (INSERT does not stamp — the trigger is BEFORE UPDATE only). The two real cases are the
  // merchant's own `/akun/keamanan` change, which re-mints in the same request and therefore pins its
  // `iat` one second past the stamp on purpose, and an operator resetting a password and redeeming an
  // impersonation link inside the same second — who gets bounced to `/login` and clicks again.
  return iat > Math.floor(passwordChangedAt.getTime() / 1000);
}
