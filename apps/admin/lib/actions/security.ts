"use server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { getSession, verifyPassword } from "@/lib/auth";
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
  await db.update(schema.users).set({ passwordHash: hashPassword(next) }).where(eq(schema.users.id, session.userId));
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
