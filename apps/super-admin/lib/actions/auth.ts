"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import {
  PLATFORM_COOKIE,
  findAdmin,
  verifyPassword,
  signPlatformSession,
  getPlatformSession,
} from "@/lib/platform-auth";
import { hashPassword } from "@tokophi/lib/password";
import { rateLimit } from "@tokophi/lib/cache";

export type SignInState = { error?: string };

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
  const row = await findAdmin(email);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    return { error: "Email atau kata sandi salah." };
  }
  const token = await signPlatformSession({
    adminId: row.id,
    email: row.email,
    name: row.name ?? "",
    role: row.role,
  });
  (await cookies()).set(PLATFORM_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
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
  (await cookies()).set(PLATFORM_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return { ok: true };
}
