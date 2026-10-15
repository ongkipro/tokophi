import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_STATE_COOKIE, authorizeUrl, googleConfig, newOAuthState } from "@tokophi/lib/google-oauth";

// Kick off the Google OAuth code flow. `mode` (login|daftar) rides along in the state cookie:
//   • daftar → an unknown email auto-provisions a store (same one-txn path as the Daftar form)
//   • login  → an unknown email is REJECTED (never silently create a store from /login)
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cfg = googleConfig();
  if (!cfg) return NextResponse.redirect(new URL("/login", req.url)); // feature-flagged off
  const mode = req.nextUrl.searchParams.get("mode") === "daftar" ? "daftar" : "login";
  const state = newOAuthState(mode);

  const res = NextResponse.redirect(authorizeUrl(cfg, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
