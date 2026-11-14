// Affiliate identity and sessions (ADR 0022, AFFILIATE-P2). Its OWN accounts: email + password, never a
// buyer "Akun TokoΦ" — nothing here reads or writes `buyer_accounts` / `buyer_sessions`.
//
// Cross-tenant platform data on the owner connection: every statement carries an explicit account id or
// session-token-hash predicate. Functions take `db` so the real-Postgres tests can run them inside a
// rolled-back transaction.
//
// A session is an OPAQUE random token (32 bytes, base64url) in an HttpOnly cookie; the database keeps only
// its sha256. A database read therefore cannot be replayed as a session, and nothing here needs a signing
// secret — the row decides on every request (revoked, expired, or a disabled account ⇒ signed out).
import { createHash, randomBytes } from "node:crypto";
import type { db as DbClient } from "@tokophi/db";
import * as schema from "@tokophi/db/schema";
import { hashPassword, verifyPassword } from "@tokophi/lib/password";
import { emailError, nameError, normalizeEmail, normalizeName, normalizePhone } from "@tokophi/lib/validate";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";

export type Db = typeof DbClient;
export type Account = { id: string; email: string; name: string; phone: string };

/** A session lives this long from sign-in, whatever its activity (the cookie lives as long). */
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
export const PASSWORD_MIN = 8;
/** scrypt on an unbounded string is a cheap CPU-burn for whoever sends it. */
export const PASSWORD_MAX = 128;

const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url, no padding

/** sha256 of a session token, or null for anything that cannot be one (never hashed, never queried). */
export function hashSessionToken(token: unknown): string | null {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  return createHash("sha256").update(`affiliate-session:${token}`).digest("hex");
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSessionToken(token)! };
}

export function passwordError(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  if (pw.length > PASSWORD_MAX) return `Kata sandi maksimal ${PASSWORD_MAX} karakter.`;
  return null;
}

export type SignUpInput = { name: unknown; email: unknown; phone: unknown; password: unknown };
export type SignUpResult =
  | { ok: true; accountId: string }
  | { ok: false; errors: Partial<Record<"name" | "email" | "phone" | "password" | "form", string>> };

/**
 * Create an account. Validation is the boundary (the form is UX). A taken email is refused by the
 * UNIQUE constraint, not by a check-then-insert, so two tabs cannot both create one.
 * ⚠️ "Email sudah terdaftar" tells a caller that the address has an affiliate account — the same answer
 * every sign-up form gives (the Seller one too). Sign-up is rate-limited per IP by the caller.
 */
export async function signUp(db: Db, input: SignUpInput): Promise<SignUpResult> {
  const errors: Partial<Record<"name" | "email" | "phone" | "password", string>> = {};
  const nameErr = nameError(input.name);
  if (nameErr) errors.name = nameErr;
  const email = normalizeEmail(input.email);
  if (!email) errors.email = "Email wajib diisi.";
  else {
    const e = emailError(email);
    if (e) errors.email = e;
  }
  const phone = normalizePhone(input.phone);
  if (!phone) errors.phone = "Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890.";
  const pwErr = passwordError(input.password);
  if (pwErr) errors.password = pwErr;
  if (Object.keys(errors).length) return { ok: false, errors };

  const [row] = await db
    .insert(schema.affiliateAccounts)
    .values({ email: email!, name: normalizeName(input.name), phone: phone!, passwordHash: hashPassword(input.password as string) })
    .onConflictDoNothing({ target: schema.affiliateAccounts.email })
    .returning({ id: schema.affiliateAccounts.id });
  if (!row) return { ok: false, errors: { email: "Email ini sudah terdaftar. Silakan masuk." } };
  return { ok: true, accountId: row.id };
}

/** Email + password → the account id, or null. Always runs scrypt once, so a missing address costs the
 *  same time as a wrong password. A disabled account answers exactly like a wrong password. */
export async function checkCredentials(db: Db, emailRaw: unknown, password: unknown): Promise<string | null> {
  const email = normalizeEmail(emailRaw);
  const pw = typeof password === "string" ? password.slice(0, PASSWORD_MAX + 1) : "";
  const [row] = email
    ? await db
        .select({ id: schema.affiliateAccounts.id, hash: schema.affiliateAccounts.passwordHash, disabledAt: schema.affiliateAccounts.disabledAt })
        .from(schema.affiliateAccounts)
        .where(eq(schema.affiliateAccounts.email, email))
        .limit(1)
    : [];
  // A throwaway hash of the same shape keeps the timing of "no such account" equal to "wrong password".
  const ok = verifyPassword(pw, row?.hash ?? DUMMY_HASH);
  return row && ok && !row.disabledAt ? row.id : null;
}
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

/** Mint a session row and return the token for the cookie (the only copy of it). */
export async function createSession(db: Db, accountId: string, userAgent: string | null): Promise<string> {
  const { token, hash } = newSessionToken();
  await db.insert(schema.affiliateSessions).values({
    tokenHash: hash,
    accountId,
    expiresAt: sql`now() + make_interval(secs => ${SESSION_MAX_AGE_SEC})`,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

/** The row decides, never the cookie: revoked, expired, unknown, or a disabled account ⇒ null. */
export async function loadSession(db: Db, token: unknown): Promise<{ sessionId: string; account: Account } | null> {
  const hash = hashSessionToken(token);
  if (!hash) return null;
  const s = schema.affiliateSessions;
  const a = schema.affiliateAccounts;
  const [row] = await db
    .select({ sessionId: s.id, id: a.id, email: a.email, name: a.name, phone: a.phone })
    .from(s)
    .innerJoin(a, eq(a.id, s.accountId))
    .where(and(eq(s.tokenHash, hash), isNull(s.revokedAt), gt(s.expiresAt, sql`now()`), isNull(a.disabledAt)))
    .limit(1);
  if (!row) return null;
  // Cheap liveness stamp, at most every 5 minutes.
  await db
    .update(s)
    .set({ lastSeenAt: sql`now()` })
    .where(and(eq(s.id, row.sessionId), sql`${s.lastSeenAt} < now() - interval '5 minutes'`));
  return { sessionId: row.sessionId, account: { id: row.id, email: row.email, name: row.name, phone: row.phone } };
}

export async function revokeSession(db: Db, accountId: string, sessionId: string): Promise<void> {
  await db
    .update(schema.affiliateSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(schema.affiliateSessions.id, sessionId), eq(schema.affiliateSessions.accountId, accountId), isNull(schema.affiliateSessions.revokedAt)));
}

export type ChangePasswordResult = { ok: true; signedOutOthers: number } | { ok: false; error: string; field: "current" | "next" };

/**
 * "Ganti kata sandi": the current password must verify; the new one must differ. Every OTHER live session
 * of this account is revoked in the same transaction — a password change is what someone does when they
 * suspect another device has it.
 */
export async function changePassword(db: Db, accountId: string, sessionId: string, current: unknown, next: unknown): Promise<ChangePasswordResult> {
  const err = passwordError(next);
  if (err) return { ok: false, error: err, field: "next" };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ hash: schema.affiliateAccounts.passwordHash })
      .from(schema.affiliateAccounts)
      .where(and(eq(schema.affiliateAccounts.id, accountId), isNull(schema.affiliateAccounts.disabledAt)))
      .for("update")
      .limit(1);
    const cur = typeof current === "string" ? current.slice(0, PASSWORD_MAX + 1) : "";
    if (!row || !verifyPassword(cur, row.hash)) return { ok: false, error: "Kata sandi saat ini salah.", field: "current" } as const;
    if (verifyPassword(next as string, row.hash)) return { ok: false, error: "Kata sandi baru harus berbeda dari yang sekarang.", field: "next" } as const;
    await tx.update(schema.affiliateAccounts).set({ passwordHash: hashPassword(next as string) }).where(eq(schema.affiliateAccounts.id, accountId));
    const others = await tx
      .update(schema.affiliateSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(schema.affiliateSessions.accountId, accountId), ne(schema.affiliateSessions.id, sessionId), isNull(schema.affiliateSessions.revokedAt)))
      .returning({ id: schema.affiliateSessions.id });
    return { ok: true, signedOutOthers: others.length } as const;
  });
}
