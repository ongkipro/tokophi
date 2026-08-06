import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { authSecretBytes } from "@tokophi/lib/secret";

// Edge-safe: only verifies the session JWT (no DB). Password check happens in the
// signIn server action (Node runtime). `secret` is lazy (throws in prod if AUTH_SECRET is unset,
// never at build) — see @tokophi/lib/secret.
const secret = () => authSecretBytes();

// Nothing in the merchant admin may be indexed. next.config.ts sets X-Robots-Tag for everything
// the router serves, but a middleware redirect/rewrite short-circuits that — so stamp it here too.
function noRobots(res: NextResponse) {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, secret(), { algorithms: ["HS256"] });
      valid = true;
    } catch {
      valid = false;
    }
  }
  const { pathname } = req.nextUrl;
  const isLogin = pathname === "/login";
  // Public self-serve signup + the Google OAuth code-flow routes (start/callback) — all must run
  // unauthenticated: they are what *creates* the session.
  const isDaftar = pathname === "/daftar";
  const isGoogleAuth = pathname.startsWith("/api/auth/google/");
  // /impersonate exchanges a signed one-time token (from the super-admin) for a session cookie
  // on THIS domain — must run unauthenticated (cross-subdomain cookies aren't shared).
  const isImpersonate = pathname === "/impersonate";
  if (!valid && !isLogin && !isDaftar && !isGoogleAuth && !isImpersonate) {
    return noRobots(NextResponse.redirect(new URL("/login", req.url)));
  }
  if (valid && (isLogin || isDaftar)) {
    return noRobots(NextResponse.redirect(new URL("/", req.url)));
  }

  // Shopify-style store context in the URL: /store/{slug}/{rest} serves the internal route /{rest}.
  // The store is still scoped by the session (RLS enforces regardless), so the slug is a display/
  // deep-link handle — passed as a header for the layout to validate/label. Backward-compatible:
  // the un-prefixed routes (/produk, …) keep working.
  const m = pathname.match(/^\/store\/([^/]+)(\/.*)?$/);
  if (m) {
    const url = req.nextUrl.clone();
    url.pathname = m[2] || "/";
    const res = NextResponse.rewrite(url);
    res.headers.set("x-tokophi-store", m[1]);
    return noRobots(res);
  }
  return noRobots(NextResponse.next());
}

export const config = {
  // Protect everything except Next internals, static files, public product images,
  // the public storefront-facing API (e.g. /api/public/ongkir), and robots.txt (which must be
  // served to crawlers, not redirected to /login). Routes excluded here still get the
  // X-Robots-Tag header from next.config.ts `headers()`.
  //
  // ⚠️ `api/health/` is excluded for the same reason as `api/cron/`: it is asked BY A MACHINE that
  // holds no session — right after a deploy, to find out whether the environment actually arrived
  // (N60). Left inside the matcher it answered **307 to /login**, which a `curl` reads as "fine" —
  // measured while building it. It carries its own gate (`CRON_SECRET`, fail-closed in production),
  // so leaving the matcher does not leave it open.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|products/|api/public/|api/cron/|api/health/|api/uploads/).*)",
  ],
};
