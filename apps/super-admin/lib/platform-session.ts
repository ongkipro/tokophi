/**
 * What a verified platform cookie is WORTH, given the `platform_admins` row behind it right now.
 *
 * Pure — no DB, no `server-only` — for the same reason `platform-rank.ts` was split out of
 * `platform-auth.ts`: that module imports `@tokophi/db` at import scope, so anything living inside it
 * is untestable, and this repo has already paid for that twice (the rank gate went ungated for
 * months, and so did this).
 *
 * 🔴 WHAT THIS EXISTS TO FIX. `getPlatformSession()` decoded the 7-day JWT and returned the claims
 * verbatim. Nothing re-read `platform_admins`, ever. Driven against a live server on 2026-08-03 with
 * one operator cookie held constant:
 *
 *   | mutation applied by SQL, cookie unchanged | before | after |
 *   |---|---|---|
 *   | `role` owner → support                    | still minted a new OWNER-gated operator | refused |
 *   | `password_hash` rewritten                 | still minted one                        | bounced to /login |
 *   | the row DELETED                           | still minted one                        | bounced to /login |
 *
 * The merchant side already re-read `store_users` on every request — which is why deleting a
 * membership logs a merchant out. The CONTROL PLANE, the surface that reaches every tenant, was the
 * weaker of the two: a deleted operator kept full access for up to seven days, and there was no
 * revocation of any kind (no `jti`, no token version, no re-read).
 *
 * ROLE COMES FROM THE ROW, NEVER FROM THE TOKEN. That is the whole point — `requirePlatformAdmin`
 * compares `RANK[session.role]`, so a role carried in a cookie is a rank the holder minted for
 * themselves at login and keeps until it expires.
 */
import { sessionOutlivesPassword } from "@tokophi/lib/session-revocation";

export type PlatformSession = { adminId: string; email: string; name: string; role: string };

/** The columns `getPlatformSession()` re-reads. `passwordChangedAt` arrived with migration 0088. */
export type PlatformAdminRow = { role: string; passwordChangedAt: Date | null };

/**
 * @param claims the JWT payload, already signature-verified by the caller.
 * @param iat    the token's `iat` claim in WHOLE SECONDS (what `SignJWT.setIssuedAt()` writes).
 * @param row    the operator's row as it stands NOW, or null if it is gone.
 * @returns the session to act on, or null — which every caller must treat as "not logged in".
 */
export function resolvePlatformSession(
  claims: Partial<PlatformSession> | null | undefined,
  iat: number | undefined,
  row: PlatformAdminRow | null | undefined,
): PlatformSession | null {
  // A token that does not name an operator cannot be re-checked against one. Fail closed.
  if (!claims?.adminId) return null;

  // The operator was removed. Their session ends on the next request, not in six days' time —
  // deleting the row IS the lockout, and it has to work the way an operator expects it to.
  if (!row) return null;

  // The credential that opened this session has been rotated since. Same rule, same function and the
  // same one-second tie-break as the merchant side; see `@tokophi/lib/session-revocation`.
  if (!sessionOutlivesPassword(iat, row.passwordChangedAt)) return null;

  // Identity from the token (it is signed, and email/name are labels), RANK from the database.
  return { adminId: claims.adminId, email: claims.email ?? "", name: claims.name ?? "", role: row.role };
}
