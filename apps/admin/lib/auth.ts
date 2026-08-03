import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { authSecretBytes } from "@tokophi/lib/secret";
import { hashPassword } from "@tokophi/lib/password";
import { sessionOutlivesPassword } from "@tokophi/lib/session-revocation";

// Lazy (throws in prod if AUTH_SECRET is unset, never at build) — see @tokophi/lib/secret.
const secret = () => authSecretBytes();
export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7d — matches the JWT expiry

export type Session = { userId: string; storeId: string; role: string; email: string; name: string };

// Re-exported, not re-implemented. There were FIVE byte-identical copies of this four-line function
// (here, `actions/security.ts`, `packages/db/src/seed.ts`, `@tokophi/lib/password`, and the deleted
// `super-admin/lib/temp-password.ts`) — the same shape that let the MINT drift to 24 bits in one copy
// while the other said 32. Nothing here drifts yet; the point is that a copy is where it would.
// `verifyPassword` below is the reader of this format, so the writer stays one function.
// The specifier stays `@/lib/auth` for every caller — this is a re-export, not a call-site change.
export { hashPassword };

// scrypt "salt:hash" — the verifier for what `hashPassword` writes (16-byte hex salt, 64-byte key).
export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pw, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function findLogin(email: string) {
  const [row] = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      passwordHash: schema.users.passwordHash,
      totpEnabled: schema.users.totpEnabled,
      totpSecret: schema.users.totpSecret,
      storeId: schema.storeUsers.storeId,
      role: schema.storeUsers.role,
      slug: schema.stores.slug,
    })
    .from(schema.users)
    .innerJoin(schema.storeUsers, eq(schema.storeUsers.userId, schema.users.id))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeUsers.storeId))
    .where(eq(schema.users.email, email.toLowerCase().trim()))
    .limit(1);
  return row ?? null;
}

/**
 * `issuedAt` overrides the token's `iat`. Exactly one caller passes it — `changePassword`, which has
 * just rotated the credential and must hand the merchant's own tab a replacement that is
 * unambiguously NEWER than the rotation it caused. See `sessionOutlivesPassword` for why "same
 * second" is not good enough. Everyone else mints at `now()`.
 */
export async function signSession(s: Session, issuedAt?: Date): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAt ? Math.floor(issuedAt.getTime() / 1000) : undefined)
    .setExpirationTime("7d")
    .sign(secret());
}

/**
 * The session, with its MEMBERSHIP RE-CHECKED against the database.
 *
 * ⚠️ It used to return the JWT payload verbatim. `role` and `storeId` are what `requireCapability`
 * gates on and what `withCurrentTenant` feeds into the RLS GUC — so for the token's full 7 days they
 * were whatever was true at login and nothing ever looked again. An owner demoted to `staf`, or
 * removed from the store entirely, kept full owner capability and full store access; and resetting the
 * password of a compromised or handed-over account — the obvious "lock them out" move, available to
 * both the merchant and super-admin — did not end the attacker's session. There was no revocation of
 * any kind: no `jti`, no token version, no re-read.
 *
 * One indexed lookup per call buys all of it back. This is a dashboard, not a high-QPS API, and the
 * alternative is a credential that cannot be withdrawn. `middleware.ts` still does the cheap edge-side
 * JWT check; this is the one that decides what you may DO.
 *
 * NOTE: `role` is taken from the row, not the token, so a demotion takes effect on the next request
 * rather than on the next login.
 *
 * ⚠️ THE COMMENT ABOVE OVERSOLD IT, AND THE GAP WAS DRIVEN, NOT ARGUED. The re-read bought back
 * demotion and removal — NOT credential rotation. Logged in as a store owner, `password_hash` was
 * rewritten and the browser stayed authenticated on `/produk`; only deleting the `store_users` row
 * ended it. So the merchant's own `/akun/keamanan` change and super-admin's "Reset password owner" —
 * both of them the obvious "lock them out" move — left a stolen 7-day cookie working.
 *
 * The same join now also reads `users.password_changed_at` (migration 0087, stamped by a BEFORE
 * UPDATE trigger so no writer can forget it) and refuses any token issued at or before it. Still ONE
 * round trip: it is an inner join onto a row this query was already keyed by.
 */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let claims: Session;
  let iat: number | undefined;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    claims = payload as unknown as Session;
    iat = payload.iat;
  } catch {
    return null;
  }
  if (!claims?.userId || !claims?.storeId) return null;
  try {
    const [membership] = await db
      .select({ role: schema.storeUsers.role, passwordChangedAt: schema.users.passwordChangedAt })
      .from(schema.storeUsers)
      .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
      .where(and(eq(schema.storeUsers.userId, claims.userId), eq(schema.storeUsers.storeId, claims.storeId)))
      .limit(1);
    // Removed from the store (or the store is gone) → the session is over, immediately.
    if (!membership) return null;
    // The password that opened this session has been rotated since → so is this session, on every
    // surface at once. Applies to an impersonated session too, by the same rule and deliberately:
    // the merchant changing their own password is the ONE lever that ends an operator's live
    // impersonation of them, and that is the incident-response behaviour you would want.
    if (!sessionOutlivesPassword(iat, membership.passwordChangedAt)) return null;
    return { ...claims, role: membership.role };
  } catch (err) {
    // A database blip must not silently hand back a stale role. Fail closed: the user re-authenticates.
    console.error("[auth] session membership re-check failed", err);
    return null;
  }
}
