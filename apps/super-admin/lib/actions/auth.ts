"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import {
  PLATFORM_COOKIE,
  PLATFORM_MAX_AGE,
  findAdmin,
  verifyPassword,
  signPlatformSession,
  getPlatformSession,
} from "@/lib/platform-auth";
import { hashPassword } from "@tokophi/lib/password";
import { clearFailedLogins, failedLoginLocked, rateLimit, recordFailedLogin } from "@tokophi/lib/cache";
import { sessionCookieOptions } from "@tokophi/lib/session-cookie";

export type SignInState = { error?: string };

/**
 * One `platform_activity` row per BURST of failed sign-ins on one operator address — never one per
 * attempt. Threshold, window and the ×5 escalation live in `recordFailedLogin`; this is only the
 * write.
 *
 * 🔴 The password is not a parameter here and is not reachable from here. Email + count + `ts` is the
 * whole row.
 *
 * **This is the half that matters more.** The seller panel reaches one merchant; this login reaches
 * EVERY tenant, and it is the account whose address the login page used to publish. `storeId` stays
 * null because an operator belongs to no store — the entry is platform-wide by nature.
 *
 * ⚠️ It never throws into the login path: an audit write that fails must not turn a mistyped password
 * into a crash. The failure goes to the container log instead.
 */
async function noteFailedLogin(email: string): Promise<void> {
  const text = recordFailedLogin("platform", email);
  if (!text) return;
  try {
    await db.insert(schema.platformActivity).values({ kind: "admin", text });
  } catch (e) {
    console.error("[platform-auth] failed-login audit write failed", e);
  }
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  // Brute-force guard on the CONTROL PLANE login — cap attempts per client IP before the (scrypt)
  // password check. In-process (does not survive a restart or span replicas — the known limitation
  // tracked in BACKLOG), but far better than the previous NONE. This is the operator login, so keep it
  // a touch tighter than the merchant panel: 10/min.
  const h = await headers();
  const ip = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`login:platform:${ip}`, 10, 60_000).ok) {
    return { error: "Terlalu banyak percobaan masuk. Coba lagi dalam 1 menit." };
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // N62 — the ACCOUNT-keyed brake: the IP cap above cannot see a distributed grind on one operator
  // address. Checked BEFORE `findAdmin`/`recordFailedLogin`, so a refused attempt costs no scrypt
  // and does not extend the streak's idle window (see `failedLoginLocked` in cache.ts).
  if (failedLoginLocked("platform", email)) {
    return { error: "Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit." };
  }
  const row = await findAdmin(email);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    await noteFailedLogin(email);
    return { error: "Email atau kata sandi salah." };
  }
  clearFailedLogins("platform", email);
  const token = await signPlatformSession({
    adminId: row.id,
    email: row.email,
    name: row.name ?? "",
    role: row.role,
  });
  (await cookies()).set(PLATFORM_COOKIE, token, sessionCookieOptions(PLATFORM_MAX_AGE));
  redirect("/");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(PLATFORM_COOKIE);
  redirect("/login");
}

/**
 * An operator changes their OWN control-plane password.
 *
 * 🔴 THERE WAS NO WAY TO DO THIS. Not a missing screen — a missing path: nothing in the repo wrote
 * `platform_admins.password_hash` outside `invitePlatformAdmin` (which only INSERTs a brand-new
 * operator). So an operator's password could be set once, by whoever invited them, and never again by
 * anyone — including themselves. When the super-admin password in use was exposed in a chat
 * transcript there was no UI anywhere that could rotate it.
 *
 * ⚠️ THE GATE IS A SESSION, NOT A RANK, AND THAT IS DELIBERATE. Every mutating action in
 * `actions.ts` calls `requirePlatformAdmin(min)` because those act on OTHER people's accounts and
 * other people's stores. This one acts on the caller's own row and on nothing else, so a rank floor
 * would only stop a `support` operator from rotating a credential that has been leaked — which is
 * the opposite of what we want. The credential is re-proved instead: `current` must verify.
 *
 * Rotating STAMPS `password_changed_at` (migration 0088's trigger), which revokes every session this
 * password opened — the point of the exercise, and it includes the tab we are answering. So this
 * browser is handed a replacement: the person here proved they know the current password two lines
 * ago, and signing them out with a toast that says "berhasil" would send them to /login with no idea
 * why. `iat` is pinned one second PAST the stamp because both happen inside one request and would
 * otherwise land in the same second, which `sessionOutlivesPassword` resolves to REVOKED on purpose.
 * Same shape, and the same reasoning, as `changePassword` in `apps/admin/lib/actions/security.ts`.
 */
export async function changePlatformPassword(current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPlatformSession();
  if (!session) return { ok: false, error: "Sesi berakhir. Masuk lagi lalu ulangi." };
  if (next.length < 8) return { ok: false, error: "Kata sandi baru minimal 8 karakter." };

  const [row] = await db
    .select({ hash: schema.platformAdmins.passwordHash })
    .from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.id, session.adminId))
    .limit(1);
  if (!row || !verifyPassword(current, row.hash)) return { ok: false, error: "Kata sandi saat ini salah." };
  // Re-saving the same string would report success while stamping nothing — the trigger is
  // `is distinct from`, so no rotation, no revocation, and a leaked credential still live.
  if (verifyPassword(next, row.hash)) return { ok: false, error: "Kata sandi baru harus berbeda dari yang sekarang." };

  const [rotated] = await db
    .update(schema.platformAdmins)
    .set({ passwordHash: hashPassword(next) })
    .where(eq(schema.platformAdmins.id, session.adminId))
    .returning({ changedAt: schema.platformAdmins.passwordChangedAt });

  // Audited like every other operator action. The password itself is never written anywhere near it.
  await db.insert(schema.platformActivity).values({
    kind: "admin",
    text: `Operator ${session.email} mengubah kata sandinya sendiri — semua sesi lama dicabut`,
  });

  const stamp = rotated?.changedAt ?? new Date();
  const token = await signPlatformSession(session, new Date(stamp.getTime() + 1000));
  (await cookies()).set(PLATFORM_COOKIE, token, sessionCookieOptions(PLATFORM_MAX_AGE));
  return { ok: true };
}
