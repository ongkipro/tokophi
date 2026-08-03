// Signed recovery links for abandoned checkouts — the MINT and the VERIFY, in one module.
//
// ⚠️ THIS LIVED IN `apps/storefront/src/lib/recovery.ts` AND THAT IS WHY IT NEVER WORKED.
// The surface that must MINT a link is the ADMIN (it is the one listing abandoned carts and opening
// the WhatsApp message); the surface that must VERIFY it is the STOREFRONT. The admin cannot import
// from `apps/storefront/src`, so `signRecoveryToken` sat in the storefront with **zero callers** for
// as long as the feature existed: the verifier, the "Selamat datang kembali" banner, the basket
// restore and the field pre-fill were all live and all unreachable, because no link was ever made.
// Four separate docs recorded the feature as working. Keep the pair HERE, where both apps can reach
// it, or the same gap reopens the moment someone needs the other half.
//
// The merchant sends a WhatsApp message with a link back into the checkout; clicking it restores the
// shopper's basket AND everything they had already typed (name, phone, address). That payload is
// personal data, so the link CANNOT be `/checkout?sid=<session id>`: session ids come from
// crypto.randomUUID() in the browser and are echoed back in every /api/track beacon, and a raw id in
// a URL is a bearer credential for someone else's name + phone + address the moment it leaks (WA
// forward, screenshot, Referer header, browser history on a shared phone). Adjacent-value guessing
// is not even the main risk — leakage is.
//
// So the link carries a SIGNED token instead: HS256 JWT { sid, st } (jose — already a dependency of
// both apps, same primitive the admin session uses), keyed on a server secret the browser never
// sees, bound to the STORE it was minted for, and expiring in 7 days. Consequences:
//   · unforgeable      — no secret, no token; guessing session ids buys nothing
//   · store-bound      — a token minted for store A is rejected on store B's host (`st` must match
//                        the Host-resolved store, so a shared secret across tenants is still safe)
//   · self-expiring    — a leaked/forwarded link goes dead on its own; a raw id never would
//   · stateless        — nothing extra to store (migration 0044 has no token column, and none is
//                        needed): the token is derived from the row, and any server holding the
//                        secret can mint one for a row it can already read.
//
// Env: CHECKOUT_RECOVERY_SECRET, falling back to AUTH_SECRET (the admin already sets that one, so a
// single-secret deploy just works). ⚠️ Both apps must resolve the SAME secret or every minted link
// fails to verify — and it fails SILENTLY, as a checkout that simply does not restore. If you ever
// set CHECKOUT_RECOVERY_SECRET, set it on the admin AND the storefront.
// In production a missing secret must be impossible — `authSecret()` throws there rather than fall
// back to a public dev string; only in development does it return the dev key. Lazy, so build never
// evaluates it.
import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "./secret";

const secret = () => new TextEncoder().encode(process.env.CHECKOUT_RECOVERY_SECRET || authSecret());

export const RECOVERY_TTL = "7d";

/** Mint `?r=` for a checkout session of a given store. */
export async function signRecoveryToken(storeId: string, sessionId: string): Promise<string> {
  return await new SignJWT({ sid: sessionId, st: storeId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(RECOVERY_TTL)
    .sign(secret());
}

/**
 * Verify `?r=` against the store resolved from the Host header.
 * Returns the session id, or null (bad signature, expired, or minted for a DIFFERENT store).
 * Never throws — a bad link must render the normal, empty checkout, not a 500.
 */
export async function verifyRecoveryToken(token: string, storeId: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.st !== storeId) return null; // token from another tenant → useless here
    const sid = payload.sid;
    return typeof sid === "string" && sid ? sid.slice(0, 64) : null;
  } catch {
    return null;
  }
}

/**
 * The full link a merchant sends: `https://<host>/checkout?r=<token>`.
 *
 * `host` is the store's CANONICAL storefront host and the caller owns that choice — an active
 * primary custom domain when the store has one, else `<slug>.<base>`. Getting it wrong is not a
 * cosmetic bug: the token is store-bound, so a link on the wrong host verifies against the wrong
 * store (or none) and the shopper lands on an empty checkout with no error to explain it.
 */
export async function recoveryUrl(host: string, storeId: string, sessionId: string): Promise<string> {
  const token = await signRecoveryToken(storeId, sessionId);
  return `https://${host}/checkout?r=${encodeURIComponent(token)}`;
}
