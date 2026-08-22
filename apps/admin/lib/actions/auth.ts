"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, findLogin, verifyPassword, signSession } from "@/lib/auth";
import { verifyTotp } from "@tokophi/lib/totp";
import { clearFailedLogins, failedLoginLocked, rateLimit, recordFailedLogin } from "@tokophi/lib/cache";
import { sessionCookieOptions } from "@tokophi/lib/session-cookie";
import { db, schema } from "@tokophi/db";
import { and, eq, isNull } from "drizzle-orm";

export type SignInState = { error?: string; need2fa?: boolean };

/**
 * One `platform_activity` row per BURST of failed sign-ins on one address — never one per attempt.
 * The threshold, the window and the ×5 escalation all live in `recordFailedLogin`; this is only the
 * write, and it takes exactly what that function returns.
 *
 * 🔴 The password is not a parameter here and is not reachable from here. Email + count + `ts` is the
 * whole row.
 *
 * `storeId` scopes the entry to the merchant under attack, so it appears on that store's page in
 * Super Admin (`getStoreActivity`) and not only in the global feed. An address matching no account
 * stays platform-wide (`null`) — that is what a spray looks like, and it is worth telling apart from
 * a targeted grind.
 *
 * ⚠️ It never throws into the login path. An audit write that fails must not turn "email atau kata
 * sandi salah" into a crash for someone who simply mistyped; the failure goes to the container log,
 * which is where a broken audit write belongs.
 */
async function noteFailedLogin(email: string, storeId: string | null): Promise<void> {
  const text = recordFailedLogin("seller", email);
  if (!text) return;
  try {
    await db.insert(schema.platformActivity).values({ kind: "admin", text, storeId });
  } catch (e) {
    console.error("[auth] failed-login audit write failed", e);
  }
}

/**
 * ACCEPTING AN INVITATION IS A FACT ABOUT THE INVITEE (Task 5.3 / SEC-15).
 *
 * `store_users.accepted_at` used to be stamped by `inviteStoreUser` at the moment the OWNER pressed
 * "Undang", which made it an exact copy of `invited_at` and asserted, in the row, that somebody had
 * accepted an invitation they had not yet been told about. Nothing else ever wrote it, so the seller
 * panel could not tell "given access, never used it" from "working here". The only event that proves
 * acceptance is the invitee holding the credential and getting in — this, and it is stamped once:
 * `accepted_at is null` in the predicate means a later sign-in matches no row and the original
 * instant stands.
 *
 * ⚠️ It never throws into the login path — same rule as `noteFailedLogin`. A session that has been
 * fully earned must not be refused because a bookkeeping UPDATE failed.
 */
async function noteAccepted(userId: string, storeId: string): Promise<void> {
  try {
    await db
      .update(schema.storeUsers)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(schema.storeUsers.userId, userId),
          eq(schema.storeUsers.storeId, storeId),
          isNull(schema.storeUsers.acceptedAt),
        ),
      );
  } catch (e) {
    console.error("[auth] invitation acceptance stamp failed", e);
  }
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  // Brute-force guard: cap login attempts per client IP before the (scrypt) password check runs. This
  // is in-process — it survives neither a restart nor multiple replicas, the same known limitation as
  // every rate limit here (tracked in BACKLOG) — but it is far better than the previous state of NONE,
  // and 15/min is generous enough not to lock out a NAT'd office on a few fat-fingered passwords.
  const h = await headers();
  const ip = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`login:admin:${ip}`, 15, 60_000).ok) {
    return { error: "Terlalu banyak percobaan masuk. Coba lagi dalam 1 menit." };
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  // N62 — the ACCOUNT-keyed brake: the IP cap above cannot see a distributed grind on one address.
  // Checked BEFORE `findLogin`/`recordFailedLogin`, so a refused attempt costs no scrypt and does
  // not extend the streak's idle window (or the attacker would hold the victim's lock open forever).
  if (failedLoginLocked("seller", email)) {
    return { error: "Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit." };
  }
  const row = await findLogin(email);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    await noteFailedLogin(email, row?.storeId ?? null);
    return { error: "Email atau kata sandi salah." };
  }
  // second factor: if enabled, require a valid TOTP before issuing the session
  if (row.totpEnabled && row.totpSecret) {
    if (!code) return { need2fa: true };
    // A wrong CODE counts on the same streak as a wrong password, deliberately. It is still a failed
    // sign-in on this address, and if anything it is the louder one — whoever is typing has already
    // cleared the password. A missing code is not counted: that is the form asking for the second
    // factor, not an attempt at it.
    if (!verifyTotp(row.totpSecret, code)) {
      await noteFailedLogin(email, row.storeId);
      return { need2fa: true, error: "Kode 2FA salah." };
    }
  }
  clearFailedLogins("seller", email);
  await noteAccepted(row.userId, row.storeId);
  const token = await signSession({
    userId: row.userId,
    storeId: row.storeId,
    role: row.role,
    email: row.email,
    name: row.name ?? "",
  });
  // ⚠️ This site also carried its own `60 * 60 * 24 * 7` while `SESSION_MAX_AGE` sat exported two
  // imports up — the drift a hand-written options object always produces, and the reason the flags
  // are a module now.
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE));
  redirect(row.slug ? `/store/${row.slug}` : "/");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
