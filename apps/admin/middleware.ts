import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Edge-safe: only verifies the session JWT (no DB). Password check happens in the
// signIn server action (Node runtime).
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me");

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, secret);
      valid = true;
    } catch {
      valid = false;
    }
  }
  const { pathname } = req.nextUrl;
  const isLogin = pathname === "/login";
  if (!valid && !isLogin) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (valid && isLogin) {
    return NextResponse.redirect(new URL("/", req.url));
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
    return res;
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except Next internals, static files, public product images,
  // and the public storefront-facing API (e.g. /api/public/ongkir).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|products/|api/public/).*)"],
};
