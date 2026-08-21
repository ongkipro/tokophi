import "server-only";
import { SignJWT } from "jose";
import { authSecretBytes } from "@tokophi/lib/secret";

// Mints the SAME session cookie the admin app verifies — so the super-admin can
// "Buka Dashboard Seller" (impersonate) a store's owner. This MUST stay in lock-step with
// apps/admin/lib/auth.ts (cookie name, HS256, AUTH_SECRET, and the Session payload shape).
// Cookies on localhost are host-scoped (not port-scoped), so a cookie set here (:3001)
// is also sent to the admin (:3000).
// Lazy (throws in prod if AUTH_SECRET is unset, never at build) — see @tokophi/lib/secret.
const secret = () => authSecretBytes();

export const SESSION_COOKIE = "session";
export type Session = { userId: string; storeId: string; role: string; email: string; name: string };

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret());
}

// 🔴 `signImpersonation` / `IMPERSONATION_AUD` ARE GONE (Task 4.11 / SEC-10), and this note is here so
// nobody reintroduces them. They minted a session-shaped JWT with a distinct audience and a 2-minute
// expiry, and `impersonateStore` put it in a query string: `/impersonate?token=<jwt>&slug=<slug>`.
// The audience claim was a real fix for a real hole (it stopped a stolen 7-day merchant session being
// exchanged here) but it could not touch the shape of the problem — a JWT is VERIFIED, never SPENT,
// so the same URL worked again for every one of those 120 seconds, from browser history, from the
// next request's `Referer`, from a proxy log, from a pasted support ticket.
//
// The exchange is a row now: `impersonation_grants` (migration 0098) holds sha256(handle) and is
// consumed by one atomic UPDATE. The mint is in `lib/actions.ts` `impersonateStore`; the spend is
// `apps/admin/lib/impersonation.ts`; both agree through `@tokophi/lib/impersonation`.
// ⚠️ Adding any `sign*` here that a URL could carry puts the defect straight back.
