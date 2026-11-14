// The affiliate session cookie (ADR 0022). It carries an OPAQUE random token — never a JWT, never an id —
// and the database keeps only its sha256 (`affiliate_sessions.token_hash`, data/auth.ts).
// Separate from every other session in this product: its own cookie name, host-only on
// affiliate.tokophi.com (no `Domain=`, so it is never sent to app./rich./account. or a storefront), and a
// token that means nothing to any other surface. HttpOnly + SameSite=Lax + Secure in production — the
// one shared implementation of those flags (`@tokophi/lib/session-cookie`).
import { sessionCookieOptions } from "@tokophi/lib/session-cookie";
import { SESSION_MAX_AGE_SEC } from "../data/auth";

export const AFFILIATE_COOKIE = "tphi_affiliate";
export const affiliateCookieOptions = () => sessionCookieOptions(SESSION_MAX_AGE_SEC);

/** The client address for the per-IP limiter (Cloudflare first, then the proxy chain). */
export function clientIp(req: Request, fallback?: string): string {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || fallback || "local";
}
