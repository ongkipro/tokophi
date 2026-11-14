// Account session (ADR 0016): a jose JWT (audience `tokophi-account`) in the host-only cookie
// `tphi_account`, carrying ONLY a `buyer_sessions.id`. The row decides on every request — revoked,
// expired or unknown ⇒ signed out — the control plane's "from the row, never the cookie" rule.
//
// Separate from every Seller / Super Admin session on THREE independent axes, so a buyer session can
// never be replayed as a merchant one or the other way round:
//   1. its own cookie name, host-only on the account origin (no `Domain=`), never sent to app./rich.;
//   2. its own signing key — HMAC-derived from AUTH_SECRET under a fixed label, so a token signed with
//      the raw AUTH_SECRET (every Seller/SA session, impersonation and recovery token) does not verify
//      here, and a buyer token does not verify there;
//   3. a required audience + a uuid subject that must name a live `buyer_sessions` row.
import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "@tokophi/lib/secret";
import { sessionCookieOptions } from "@tokophi/lib/session-cookie";
import { SESSION_MAX_AGE_SEC } from "../data/account";

export const ACCOUNT_COOKIE = "tphi_account";
export const ACCOUNT_AUDIENCE = "tokophi-account";
/** The derivation label. Changing it signs every buyer out (that is its only effect). */
export const ACCOUNT_KEY_LABEL = "tokophi-account-session:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HS256 key for account sessions, derived from a given secret (exported for the UI sweep and tests). */
export const deriveAccountKey = (secret: string): Uint8Array =>
  new Uint8Array(createHmac("sha256", secret).update(ACCOUNT_KEY_LABEL).digest());

let cached: Uint8Array | undefined;
/** Lazy like `authSecretBytes()`: a production process without a strong AUTH_SECRET throws on first USE. */
export const accountSessionKey = (): Uint8Array => (cached ??= deriveAccountKey(authSecret()));

export const accountCookieOptions = () => sessionCookieOptions(SESSION_MAX_AGE_SEC);

export async function signAccountSession(sessionId: string, key: Uint8Array = accountSessionKey()): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sessionId)
    .setAudience(ACCOUNT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
    .sign(key);
}

/** The session id the cookie names, or null. Only proves the cookie was minted here — the caller
 *  must still load the row. */
export async function readAccountSession(token: string | undefined, key: Uint8Array = accountSessionKey()): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { audience: ACCOUNT_AUDIENCE, algorithms: ["HS256"] });
    return typeof payload.sub === "string" && UUID.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}
