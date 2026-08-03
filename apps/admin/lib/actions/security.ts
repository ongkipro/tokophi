"use server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { cookies } from "next/headers";
import { getSession, verifyPassword, signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { hashPassword } from "@tokophi/lib/password";
import { generateTotpSecret, verifyTotp, otpauthURL } from "@tokophi/lib/totp";

export async function getSecurity(): Promise<{ email: string; twoFactor: boolean } | null> {
  const session = await getSession();
  if (!session) return null;
  const [u] = await db.select({ email: schema.users.email, totpEnabled: schema.users.totpEnabled }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  return u ? { email: u.email, twoFactor: u.totpEnabled } : null;
}

export async function changePassword(current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  if (next.length < 8) return { ok: false, error: "Kata sandi baru minimal 8 karakter." };
  const [u] = await db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  if (!u || !verifyPassword(current, u.hash)) return { ok: false, error: "Kata sandi saat ini salah." };
  const [rotated] = await db
    .update(schema.users)
    .set({ passwordHash: hashPassword(next) })
    .where(eq(schema.users.id, session.userId))
    .returning({ changedAt: schema.users.passwordChangedAt });

  // That UPDATE fired the `users_stamp_password_changed_at` trigger, which just revoked EVERY session
  // this user has — the point of the change, and it includes the tab we are answering. So hand THIS
  // browser a replacement: the person here proved they know the current password one line ago, which
  // is the whole basis of a session, and signing them out with a toast that says "berhasil" would send
  // them to /login with no idea why.
  //
  // `iat` is pinned one second PAST the stamp rather than left at `now()`, because both happen inside
  // one request and would land in the same second — which `sessionOutlivesPassword` resolves to
  // REVOKED on purpose. Pinning makes the replacement unambiguously newer instead of relying on the
  // second boundary falling in the right place. (jose validates `exp`/`nbf`, never `iat`, so a token
  // stamped a second ahead verifies normally; `maxTokenAge` is not set anywhere.)
  const stamp = rotated?.changedAt ?? new Date();
  const token = await signSession(
    { userId: session.userId, storeId: session.storeId, role: session.role, email: session.email, name: session.name },
    new Date(stamp.getTime() + 1000),
  );
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return { ok: true };
}

// Generate a fresh TOTP secret + QR (stored but NOT enabled until a valid code is verified).
export async function setup2FA(): Promise<{ ok: boolean; qr?: string; secret?: string; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  const secret = generateTotpSecret();
  await db.update(schema.users).set({ totpSecret: secret, totpEnabled: false }).where(eq(schema.users.id, session.userId));
  const qr = await QRCode.toDataURL(otpauthURL(secret, session.email), { margin: 1, width: 200 });
  return { ok: true, qr, secret };
}

export async function enable2FA(code: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  const [u] = await db.select({ secret: schema.users.totpSecret }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  if (!u?.secret || !verifyTotp(u.secret, code)) return { ok: false, error: "Kode verifikasi salah." };
  await db.update(schema.users).set({ totpEnabled: true }).where(eq(schema.users.id, session.userId));
  return { ok: true };
}

export async function disable2FA(code: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  const [u] = await db.select({ secret: schema.users.totpSecret }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  if (u?.secret && !verifyTotp(u.secret, code)) return { ok: false, error: "Kode verifikasi salah." };
  await db.update(schema.users).set({ totpEnabled: false, totpSecret: null }).where(eq(schema.users.id, session.userId));
  return { ok: true };
}
