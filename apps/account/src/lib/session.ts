// Account session (spec §17.8 D-5): a jose JWT (audience `tokophi-account`) in the host-only cookie
// `tphi_account`, carrying ONLY a `buyer_sessions.id`. The row decides on every request — revoked,
// expired or unknown ⇒ signed out — the control plane's "from the row, never the cookie" rule.
import { SignJWT, jwtVerify } from "jose";
import { authSecretBytes } from "@tokophi/lib/secret";
import { sessionCookieOptions } from "@tokophi/lib/session-cookie";
import { SESSION_MAX_AGE_SEC } from "../data/account";

export const ACCOUNT_COOKIE = "tphi_account";
const AUDIENCE = "tokophi-account";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const accountCookieOptions = () => sessionCookieOptions(SESSION_MAX_AGE_SEC);

export async function signAccountSession(sessionId: string, key: Uint8Array = authSecretBytes()): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sessionId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
    .sign(key);
}

/** The session id the cookie names, or null. Only proves the cookie was minted here — the caller
 *  must still load the row. */
export async function readAccountSession(token: string | undefined, key: Uint8Array = authSecretBytes()): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { audience: AUDIENCE, algorithms: ["HS256"] });
    return typeof payload.sub === "string" && UUID.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}
