import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";

// The super-admin's OWN auth — platform operators (us), separate from store `users`.
// Uses a DISTINCT cookie (`platform_session`) from the admin's `session` cookie: on localhost
// cookies are host-scoped (shared across :3000/:3001), and impersonation mints the admin
// `session` cookie — so the two must not collide.
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me");
export const PLATFORM_COOKIE = "platform_session";

export type PlatformSession = { adminId: string; email: string; name: string; role: string };

export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pw, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function findAdmin(email: string) {
  const [row] = await db
    .select({
      id: schema.platformAdmins.id,
      email: schema.platformAdmins.email,
      name: schema.platformAdmins.name,
      role: schema.platformAdmins.role,
      passwordHash: schema.platformAdmins.passwordHash,
    })
    .from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.email, email.toLowerCase().trim()))
    .limit(1);
  return row ?? null;
}

export async function signPlatformSession(s: PlatformSession): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
}

export async function getPlatformSession(): Promise<PlatformSession | null> {
  const token = (await cookies()).get(PLATFORM_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as PlatformSession;
  } catch {
    return null;
  }
}

// Security boundary for every super-admin mutation (impersonation + store lifecycle).
export async function requirePlatformAdmin(): Promise<PlatformSession> {
  const s = await getPlatformSession();
  if (!s) throw new Error("Tidak diizinkan — perlu login platform admin.");
  return s;
}
