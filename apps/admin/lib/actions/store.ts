"use server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE, getSession, signSession } from "@/lib/auth";
import { sessionCookieOptions } from "@tokophi/lib/session-cookie";
import { resolveMembership } from "@/lib/store-selection";
import { isUuid } from "@/lib/uuid";

export type SwitchStoreResult = { ok: true; slug: string } | { ok: false; error: string };

/**
 * SWITCHING STORES RE-MINTS THE SESSION, SERVER-SIDE, AFTER PROVING MEMBERSHIP (Task 5.9 / F-T10).
 *
 * The `storeId` argument comes from a click in the topbar — i.e. from the CLIENT — so it is a claim
 * we check, never an instruction we obey: `resolveMembership` re-reads `store_users` for (this
 * user, that store) in this same action, and zero rows is a refusal. The session cookie is the only
 * carrier of tenant context (`getSession` → RLS GUC), so the switch IS the re-mint; there is no
 * client-side path that could change the tenant.
 *
 * The role in the new token comes from the TARGET membership row, read now — a user who is owner in
 * store A and staf in store B gets staf capabilities the instant they switch (and `getSession`
 * re-reads it per request anyway; this just keeps the token honest from the first moment).
 *
 * ⚠️ An impersonated session is refused. The operator's grant was consumed for ONE store
 * (`impersonation_grants.store_id`); letting the minted session walk to the merchant's other stores
 * would widen a bounded, audited intervention past what was granted and logged.
 */
export async function switchStore(storeId: string): Promise<SwitchStoreResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi kamu sudah berakhir. Masuk lagi." };
  if (session.imp) {
    return { ok: false, error: "Mode Super Admin terikat ke satu toko. Keluar dari mode ini dulu." };
  }
  // Non-UUID input would make Postgres throw 22P02 (a 500 where a refusal belongs) — same rule as
  // every id-keyed route (`lib/uuid.ts`).
  if (!isUuid(storeId)) return { ok: false, error: "Toko tidak ditemukan." };
  const membership = await resolveMembership(session.userId, storeId);
  if (!membership) return { ok: false, error: "Kamu tidak punya akses ke toko itu." };
  const token = await signSession({
    userId: session.userId,
    storeId: membership.storeId,
    role: membership.role,
    email: session.email,
    name: session.name,
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE));
  return { ok: true, slug: membership.slug };
}
