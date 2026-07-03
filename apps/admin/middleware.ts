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
  // Protect everything except Next internals, static files, and public product images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|products/).*)"],
};
