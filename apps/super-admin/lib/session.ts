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

// Short-lived token for cross-subdomain impersonation: passed in the URL to the admin's
// /impersonate route, which verifies it and mints the real session cookie on the admin domain.
// Prod admin/super-admin live on different subdomains → cookies aren't shared, so we can't set
// the cookie here directly.
// The impersonation exchange token carries a distinct audience so the admin /impersonate route can
// require it — otherwise ANY session-shaped JWT signed with AUTH_SECRET (e.g. a stolen 7-day admin
// session) would be accepted there and exchanged for a fresh session. Ephemeral (2m, consumed on the
// redirect), so adding the claim strands nothing.
export const IMPERSONATION_AUD = "tokophi:impersonate";
export async function signImpersonation(s: Session): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setAudience(IMPERSONATION_AUD).setExpirationTime("2m").sign(secret());
}
