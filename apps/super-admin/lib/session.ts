import "server-only";
import { SignJWT } from "jose";

// Mints the SAME session cookie the admin app verifies — so the super-admin can
// "Buka Panel Admin" (impersonate) a store's owner. This MUST stay in lock-step with
// apps/admin/lib/auth.ts (cookie name, HS256, AUTH_SECRET, and the Session payload shape).
// Cookies on localhost are host-scoped (not port-scoped), so a cookie set here (:3001)
// is also sent to the admin (:3000).
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me");

export const SESSION_COOKIE = "session";
export type Session = { userId: string; storeId: string; role: string; email: string; name: string };

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
}
