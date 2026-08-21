import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSession } from "@/lib/auth";
import { logImpersonation } from "@/lib/impersonation";

/**
 * END AN IMPERSONATION — the explicit exit (Task 4.11 / SEC-10).
 *
 * A bounded session expires on its own after 30 minutes; this is how an operator ends one the moment
 * they are finished, which is the far more common case and the one that shortens the window a
 * merchant's panel is open under somebody else's hands.
 *
 * ⚠️ A ROUTE HANDLER, NOT A SERVER ACTION, FOR THE REASON `/api/auth/signout` RECORDS: a Server
 * Component cannot delete a cookie. Deleting the cookie is the whole operation — the operator
 * context lives inside the signed JWT, so there is no "operator field" to clear and nothing partial
 * to get wrong. The cookie goes, the impersonation is over, and the next request is unauthenticated.
 *
 * ⚠️ IT DOES NOT REDIRECT TO THE CONTROL PLANE, deliberately. The operator's own `platform_session`
 * cookie on `rich.tokophi.com` was never touched by any of this — their Super Admin tab is still
 * logged in and untouched behind this one. Sending them to an origin named by an env var (or worse,
 * a query parameter) would be a redirect a caller could aim; `/login` is this app's own honest
 * answer to "you no longer have a session here".
 *
 * GET on purpose: it is a link the banner points at, and it destroys only the caller's own cookie,
 * so there is nothing for a CSRF to achieve beyond ending a session the victim was ending anyway.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Read BEFORE the cookie goes: this is the last request that can name who was inside. `getSession`
  // returns null for an already-dead session, in which case there is nothing true to log — and
  // logging "an impersonation ended" without knowing whose would be the report-what-you-wrote rule
  // broken in the audit trail itself.
  const session = await getSession();
  if (session?.imp) {
    await logImpersonation(
      session.storeId,
      `Sesi impersonate diakhiri oleh ${session.imp.operatorEmail} (keluar manual)`,
    );
  }
  // Relative `Location`, same reason as the sibling route: behind Traefik the Node runtime sees
  // `req.url` as the internal `http://localhost:3000`, so building an absolute URL from it leaks the
  // internal host into the browser's address bar.
  const res = new NextResponse(null, { status: 307, headers: { Location: "/login" } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
