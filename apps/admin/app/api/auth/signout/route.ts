import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drop the session cookie and go to the login screen.
 *
 * ⚠️ THIS EXISTS BECAUSE A REDIRECT ALONE LOOPS. `getSession()` now re-reads `store_users` on every
 * request, so a user removed from a store still holds a perfectly valid, unexpired JWT — the admin
 * layout has to turn them away. But `middleware.ts` runs on the edge with no database: it sees a valid
 * token and sends anyone hitting `/login` straight back to `/`. Layout → /login → / → layout is
 * `ERR_TOO_MANY_REDIRECTS`, which is what happened the first time this was written.
 *
 * A Server Component cannot set a cookie; a route handler can. So the layout redirects HERE, the
 * cookie goes, and the next request is genuinely unauthenticated — middleware and the layout finally
 * agree about who this person is.
 *
 * GET on purpose: it is the target of a redirect, not a form post. It destroys only the caller's own
 * cookie, so there is nothing for a CSRF to achieve beyond logging someone out.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
