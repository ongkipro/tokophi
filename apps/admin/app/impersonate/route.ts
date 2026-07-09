import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE, signSession, type Session } from "@/lib/auth";

// Cross-subdomain impersonation exchange. The super-admin ("Buka panel admin") sends a short-lived
// signed token (same AUTH_SECRET) here; we verify it and set a real `session` cookie on THIS
// (admin) domain, then deep-link into the impersonated store. Cookies can't be shared across
// subdomains, so setting the cookie from the super-admin app doesn't reach here — hence this route.
export const runtime = "nodejs";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me");

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const slug = req.nextUrl.searchParams.get("slug");
  const dest = slug ? `/store/${slug}` : "/";
  if (!token) return NextResponse.redirect(new URL("/login", req.url));
  try {
    const { payload } = await jwtVerify(token, secret);
    const s = payload as unknown as Session;
    if (!s.userId || !s.storeId) throw new Error("bad payload");
    // re-sign a full-length admin session (the incoming token is intentionally short-lived)
    const full = await signSession({
      userId: s.userId,
      storeId: s.storeId,
      role: s.role,
      email: s.email,
      name: s.name,
    });
    const res = NextResponse.redirect(new URL(dest, req.url));
    res.cookies.set(SESSION_COOKIE, full, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}
