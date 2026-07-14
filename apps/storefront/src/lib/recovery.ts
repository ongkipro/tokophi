// Signed recovery links for abandoned checkouts.
//
// The merchant sends a WhatsApp message with a link back into the checkout; clicking it restores the
// shopper's basket AND everything they had already typed (name, phone, address). That payload is
// personal data, so the link CANNOT be `/checkout?sid=<session id>`: session ids come from
// crypto.randomUUID() in the browser and are echoed back in every /api/track beacon, and a raw id in
// a URL is a bearer credential for someone else's name + phone + address the moment it leaks (WA
// forward, screenshot, Referer header, browser history on a shared phone). Adjacent-value guessing
// is not even the main risk — leakage is.
//
// So the link carries a SIGNED token instead: HS256 JWT { sid, st } (jose — already a storefront
// dependency, same primitive the admin session uses), keyed on a server secret the browser never
// sees, bound to the STORE it was minted for, and expiring in 7 days. Consequences:
//   · unforgeable      — no secret, no token; guessing session ids buys nothing
//   · store-bound      — a token minted for store A is rejected on store B's host (`st` must match
//                        the Host-resolved store, so a shared secret across tenants is still safe)
//   · self-expiring    — a leaked/forwarded link goes dead on its own; a raw id never would
//   · stateless        — nothing extra to store (migration 0044 has no token column, and none is
//                        needed): the token is derived from the row, and any server holding the
//                        secret can mint one for a row it can already read.
//
// The MERCHANT ADMIN mints these (it is the surface that lists abandoned carts and sends the WA
// message). It must use the SAME secret and the SAME claims:
//
//   await new SignJWT({ sid: session_id, st: store_id })
//     .setProtectedHeader({ alg: "HS256" })
//     .setIssuedAt().setExpirationTime("7d")
//     .sign(new TextEncoder().encode(process.env.CHECKOUT_RECOVERY_SECRET ?? process.env.AUTH_SECRET))
//   → https://<store host>/checkout?r=<token>
//
// Env: CHECKOUT_RECOVERY_SECRET, falling back to AUTH_SECRET (the admin already sets that one, so a
// single-secret deploy just works). The dev fallback below exists so a local storefront started
// without env does not crash — it is NOT a production secret.
import { SignJWT, jwtVerify } from "jose";

const secret = () =>
  new TextEncoder().encode(
    process.env.CHECKOUT_RECOVERY_SECRET ||
      process.env.AUTH_SECRET ||
      "tokophi-dev-recovery-secret-change-me",
  );

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
