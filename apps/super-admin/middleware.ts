import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Edge-safe: verifies the platform-admin session JWT only (no DB). Checks `platform_session`,
// NOT the admin app's `session` cookie (which is also present on localhost) — so an admin
// login never grants super-admin access.
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me");

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("platform_session")?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, secret);
      valid = true;
    } catch {
      valid = false;
    }
  }
  const isLogin = req.nextUrl.pathname === "/login";
  if (!valid && !isLogin) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (valid && isLogin) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
