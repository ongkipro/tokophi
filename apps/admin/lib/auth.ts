import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me");
export const SESSION_COOKIE = "session";

export type Session = { userId: string; storeId: string; role: string; email: string; name: string };

// scrypt "salt:hash" (matches the seed's hashPassword).
export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(pw, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function findLogin(email: string) {
  const [row] = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      passwordHash: schema.users.passwordHash,
      storeId: schema.storeUsers.storeId,
      role: schema.storeUsers.role,
      slug: schema.stores.slug,
    })
    .from(schema.users)
    .innerJoin(schema.storeUsers, eq(schema.storeUsers.userId, schema.users.id))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeUsers.storeId))
    .where(eq(schema.users.email, email.toLowerCase().trim()))
    .limit(1);
  return row ?? null;
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as Session;
  } catch {
    return null;
  }
}
