import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, signSession } from "@/lib/auth";
import { sessionCookieOptions } from "@tokophi/lib/session-cookie";
import { IMPERSONATION_SESSION_EXPIRY, IMPERSONATION_SESSION_MAX_AGE } from "@tokophi/lib/impersonation";
import { consumeImpersonationGrant, logImpersonation } from "@/lib/impersonation";

/**
 * THE IMPERSONATION EXCHANGE — spend a one-time handle, mint a bounded merchant session.
 *
 * The super-admin ("Buka Dashboard Seller") writes an `impersonation_grants` row and sends the
 * operator's browser here with the opaque handle. Cookies are not shared across subdomains
 * (`rich.tokophi.com` cannot set one for `app.tokophi.com`), which is why this route exists at all.
 *
 * 🔴 WHAT THIS ROUTE USED TO DO, AND WHY IT WAS REPLACED (Task 4.11 / SEC-10). It took a
 * session-shaped JWT out of the query string and `jwtVerify`'d it. Verification is stateless, so the
 * SAME URL worked again — and again — for the token's whole two-minute life, by anyone who found it
 * in browser history, in a `Referer`, in a proxy log or in a pasted support ticket. There was no
 * place to record that the link had been used, so replay was not a bug to fix here; the credential
 * had to stop being a bearer token. It is now an opaque handle that a single atomic UPDATE spends.
 *
 * ⚠️ EVERY FAILURE LOOKS IDENTICAL FROM OUTSIDE — one redirect to `/login`, no message, no status
 * difference. Unknown handle, replayed handle, expired handle, demoted operator, removed
 * membership: the reason is classified for OUR log and nothing else, because telling a caller which
 * of those it was is an oracle for guessing handles. Fail closed, and fail the same way.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relative-Location redirect: behind Traefik the Node runtime sees req.url as the internal
// http://localhost:3000, so `new URL(path, req.url)` leaks the internal host. A relative
// Location resolves against the browser's origin (the real sslip.io/app domain) instead.
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

export async function GET(req: NextRequest) {
  const result = await consumeImpersonationGrant(req.nextUrl.searchParams.get("grant"));
  if (!result.ok) {
    // Server-side only. The handle itself is never logged — a log line is exactly the kind of place
    // this credential used to leak from.
    console.warn(`[impersonate] exchange refused: ${result.reason}`);
    return redirectTo("/login");
  }

  const { session, slug } = result;
  // BOUNDED. Both halves come from one constant so the cookie and the token cannot outlive each
  // other — see `@tokophi/lib/impersonation`.
  const token = await signSession(session, undefined, IMPERSONATION_SESSION_EXPIRY);
  const res = redirectTo(`/store/${encodeURIComponent(slug)}`);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(IMPERSONATION_SESSION_MAX_AGE));

  // Report what you WROTE. `impersonateStore` logged that a LINK was created; this is the line that
  // says somebody actually walked in, and it is the one an operator reconstructing an incident
  // needs. Written after the claim committed, so it can never describe an exchange that failed.
  await logImpersonation(
    session.storeId,
    `Sesi impersonate dimulai oleh ${session.imp?.operatorEmail ?? "operator"} sebagai ${session.email} (berakhir otomatis dalam ${IMPERSONATION_SESSION_MAX_AGE / 60} menit)`,
  );
  return res;
}
