import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/auth";
import { OAUTH_STATE_COOKIE, exchangeCode, googleConfig } from "@/lib/google";
import { provisionStore } from "@/lib/provision";

// Google OAuth callback: state check → code exchange → id_token verify (JWKS) → find-or-create the
// user → sign the SAME jose session JWT as lib/auth.ts.
// Rules: on mode=daftar an unknown email auto-provisions a store (one txn, 3-day trial);
// on mode=login an unknown email is rejected ("Akun belum terdaftar — silakan Daftar").
export const runtime = "nodejs";

// Relative Location (same reasoning as /impersonate: behind a proxy req.url is the internal host).
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

export async function GET(req: NextRequest) {
  const cfg = googleConfig();
  if (!cfg) return redirectTo("/login");

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const mode = (cookieState ?? "").startsWith("daftar.") ? "daftar" : "login";
  const back = mode === "daftar" ? "/daftar" : "/login";

  if (url.searchParams.get("error")) return redirectTo(`${back}?error=google_batal`);
  if (!code || !state || !cookieState || state !== cookieState) return redirectTo(`${back}?error=google_state`);

  const profile = await exchangeCode(cfg, code);
  if (!profile || !profile.emailVerified) return redirectTo(`${back}?error=google_gagal`);

  // 1) known user (by google_sub, else by email → link the sub)
  const [bySub] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.googleSub, profile.sub))
    .limit(1);
  const [byEmail] = bySub
    ? [null]
    : await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, profile.email)).limit(1);
  const userId = bySub?.id ?? byEmail?.id ?? null;

  if (userId && !bySub) {
    // existing (password) account with the same email → link Google, keep passwordHash intact
    await db.update(schema.users).set({ googleSub: profile.sub, authProvider: "google" }).where(eq(schema.users.id, userId));
  }

  let session: { userId: string; storeId: string; role: string; email: string; name: string } | null = null;
  let slug: string | null = null;

  const [row] = userId
    ? await db
        .select({
          userId: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
          storeId: schema.storeUsers.storeId,
          role: schema.storeUsers.role,
          slug: schema.stores.slug,
        })
        .from(schema.users)
        .innerJoin(schema.storeUsers, eq(schema.storeUsers.userId, schema.users.id))
        .innerJoin(schema.stores, eq(schema.stores.id, schema.storeUsers.storeId))
        .where(eq(schema.users.id, userId))
        .limit(1)
    : [];
  if (row) {
    session = { userId: row.userId, storeId: row.storeId, role: row.role, email: row.email, name: row.name ?? profile.name };
    slug = row.slug;
  } else if (mode === "daftar") {
    // unknown email (or a user with no store yet) → auto-provision a store on the same one-txn path
    const r = await provisionStore({
      storeName: profile.name,
      ownerName: profile.name,
      email: profile.email,
      authProvider: "google",
      googleSub: userId ? null : profile.sub,
      userId: userId ?? undefined,
    });
    session = { userId: r.userId, storeId: r.storeId, role: r.role, email: r.email, name: r.name };
    slug = r.slug;
  } else {
    return redirectTo("/login?error=google_belum_daftar");
  }

  const token = await signSession(session);
  const res = redirectTo(slug ? `/store/${slug}` : "/");
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
