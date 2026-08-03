import { NextResponse, type NextRequest } from "next/server";
import { PLATFORM_COOKIE } from "@/lib/platform-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drop the platform session cookie and go to the login screen.
 *
 * ⚠️ THIS EXISTS BECAUSE A REDIRECT ALONE LOOPS — measured here, not reasoned about.
 * `getPlatformSession()` now re-reads `platform_admins` on every request, so an operator whose row
 * was deleted (or whose password was rotated) still holds a perfectly valid, unexpired JWT and the
 * platform layout has to turn them away. But `middleware.ts` runs on the edge with no database: it
 * sees a valid token and sends anyone hitting `/login` straight back to `/`. Layout → /login → / →
 * layout is `ERR_TOO_MANY_REDIRECTS`, and that is exactly what the verification run produced.
 *
 * A Server Component cannot set a cookie; a route handler can. So the layout redirects HERE, the
 * cookie goes, and the next request is genuinely unauthenticated.
 *
 * This is the same file, for the same reason, as `apps/admin/app/api/auth/signout/route.ts` — the
 * merchant side hit this the moment IT started re-reading, one wave earlier. Two apps, two cookies,
 * two middlewares; nothing here is shareable but the lesson.
 *
 * GET on purpose: it is the target of a redirect, not a form post. It destroys only the caller's own
 * cookie, so there is nothing for a CSRF to achieve beyond logging someone out.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(PLATFORM_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
