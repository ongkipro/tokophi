import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { authSecretBytes } from "@tokophi/lib/secret";

// Edge-safe: verifies the platform-admin session JWT only (no DB). Checks `platform_session`,
// NOT the admin app's `session` cookie (which is also present on localhost) — so an admin
// login never grants super-admin access. `secret` is lazy (throws in prod if AUTH_SECRET is unset,
// never at build) — see @tokophi/lib/secret.
//
// 🔴 THE RANK IS NOT ENFORCED HERE, AND IT CANNOT BE (Task 5.17 / SEC-9). This file runs on the
// EDGE: it has no database, and the control plane's standing rule is that an operator's rank comes
// from `platform_admins` on EVERY request, never from the cookie. Adding `role` to the JWT to make
// a check possible here would hand every operator a rank they minted for themselves at login and
// kept for seven days — precisely the defect `resolvePlatformSession` was written to close. The
// route floors are enforced one layer in, by `platformRouteGate(path)` at the top of each page,
// above its first privileged read (`lib/route-roles.ts` holds the map).
// ⚠️ And note what this file must keep NOT doing: it may only redirect a request with NO valid JWT.
// A dead-but-valid cookie is bounced by the layout/page to `/api/auth/signout`, because middleware
// would send `/login` straight back to `/` and the two would ping-pong (ERR_TOO_MANY_REDIRECTS).
const secret = () => authSecretBytes();

// The control plane is never indexable. next.config.ts sets X-Robots-Tag on everything the router
// serves, but a middleware redirect short-circuits that — so stamp it here too.
function noRobots(res: NextResponse) {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("platform_session")?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, secret(), { algorithms: ["HS256"] });
      valid = true;
    } catch {
      valid = false;
    }
  }
  const isLogin = req.nextUrl.pathname === "/login";
  if (!valid && !isLogin) {
    return noRobots(NextResponse.redirect(new URL("/login", req.url)));
  }
  if (valid && isLogin) {
    return noRobots(NextResponse.redirect(new URL("/", req.url)));
  }
  return noRobots(NextResponse.next());
}

export const config = {
  // robots.txt is excluded from the auth gate so crawlers get the Disallow instead of a redirect;
  // it (and every other excluded path) still gets X-Robots-Tag from next.config.ts `headers()`.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
