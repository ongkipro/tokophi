"use server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { normalizeEmail } from "@tokophi/lib/validate";
import { tempPassword } from "@tokophi/lib/password";
import { requireCapability } from "@/lib/rbac";
import { getSession, hashPassword } from "@/lib/auth";
import { withCurrentTenant } from "@/lib/tenant";

// Store staff management (Pengaturan → Pengguna). Gated on settings:write, which only the OWNER role
// has (rbac-policy: admin is ALL_CAPABILITIES minus settings:write) — so staff can never manage staff.
//
// WHY the owner connection for writes: `users` is a GLOBAL table (no store_id, no RLS) — the same
// table lib/auth.ts and super-admin create/read on the owner connection. Creating a login user is
// inherently cross-tenant, and the tokophi_app role has no INSERT grant on it. The tenant boundary is
// held instead by scoping every `store_users` row to `session.storeId` from requireCapability (trusted,
// never a client value) — identical to how super-admin's createStore provisions an owner. Reads go
// through withCurrentTenant so RLS scopes the team list (store_users has store_id; billing.ts joins
// users under the same wrapper).

export type StoreRole = "owner" | "admin" | "staff" | "gudang" | "advertiser" | "cs";
export type ManageableRole = "admin" | "staff" | "gudang" | "advertiser" | "cs";
export type StoreUserRow = {
  userId: string;
  name: string;
  email: string;
  role: StoreRole;
  isSelf: boolean;
  /**
   * ISO instant of the invitee's FIRST successful sign-in, or `null` — they have been given access
   * and have never used it. Stamped by `signIn` (`lib/actions/auth.ts`), never by the invitation:
   * see the note on `InviteResult` below. Rows written before Task 5.3 carry the invite's own
   * timestamp here, so `null` proves "never signed in" while non-null does not, on its own, prove
   * they did — which is why the UI only ever renders the `null` case.
   */
  acceptedAt: string | null;
};

/**
 * WHAT INVITING SOMEBODY ACTUALLY DID — read back from the rows, never inferred (Task 5.3 / SEC-15).
 *
 * 🔴 `outcome` is its own field, and `password` is present on every branch. AGENTS.md records why:
 * super-admin's `addStoreUser` returned a minted password whether or not it had hashed one into a
 * row, and "no password" read identically to "no password was NEEDED" at the call site. Only one of
 * those is good news. The old shape here had the same hole from the other side — the caller decided
 * "created" vs "already had an account" purely from `tempPassword` being truthy, so ANY path that
 * failed to mint would have rendered as a cheerful "they sign in with their existing password".
 *
 * The states, and what makes each one durable:
 *  - `created`         a `users` row was INSERTED by this call and `password` is the string whose
 *                      hash it carries — reported only because `.returning()` handed back that row.
 *  - `linked`          the address already had an account (they work at another store); a membership
 *                      was inserted and **their password was not touched**. Re-hashing here would
 *                      silently lock them out of the other store, with no message (AGENTS.md).
 *  - `already_invited` a membership already existed and nobody has ever signed in on it.
 *  - `already_accepted` a membership already existed and the invitee has signed in.
 *  - `failed`          nothing durable changed. Never carries a credential.
 *
 * ⚠️ There is NO MAILER in this repository. Nothing is emailed, so nothing may be reported on the
 * strength of an email having been sent; the seller hands the temporary password over themselves.
 */
export type InviteResult =
  | { outcome: "created"; email: string; role: ManageableRole; password: string }
  | { outcome: "linked"; email: string; role: ManageableRole; password: null }
  | { outcome: "already_invited"; email: string; role: StoreRole; invitedAt: string | null; password: null }
  | { outcome: "already_accepted"; email: string; role: StoreRole; password: null }
  | { outcome: "failed"; error: string; password: null };

const MANAGEABLE: ManageableRole[] = ["admin", "staff", "gudang", "advertiser", "cs"];

const fail = (error: string): InviteResult => ({ outcome: "failed", error, password: null });

export async function getStoreUsers(): Promise<StoreUserRow[]> {
  const session = await getSession();
  const selfId = session?.userId ?? "";
  return withCurrentTenant(async (tx) => {
    const rows = await tx
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.storeUsers.role,
        acceptedAt: schema.storeUsers.acceptedAt,
      })
      .from(schema.storeUsers)
      .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId));
    // Owner first, then by name — the owner is the stable anchor of the list.
    return rows
      .map((r) => ({
        userId: r.userId,
        name: r.name ?? "",
        email: r.email,
        role: r.role as StoreRole,
        isSelf: r.userId === selfId,
        acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
      }))
      .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.name.localeCompare(b.name)));
  });
}

/**
 * 🔴 THE UNIQUENESS RACE IS THE DEFECT, AND IT WAS THE COMMON CASE (measured 2026-08-22).
 *
 * The old body was read-then-write: `select … from users where email = …`, then an unguarded
 * `insert`. Twenty concurrent double-invitations of the same new address, driven against real
 * Postgres, produced **19 throws of `users_email_unique`** out of the server action — a rejected
 * promise the dialog does not catch, so the seller got no toast at all, while the database had in
 * fact converged on exactly one account and one membership every single time. The one time the race
 * landed the other way it produced `store_users_storeId_userId_unique` instead. A password had
 * already been minted on the throwing path.
 *
 * Both inserts are therefore `on conflict do nothing … returning`, and **the returned row is the
 * only thing allowed to decide what is reported**:
 *   - a row came back  ⇒ WE wrote it ⇒ `created` / `linked` may be claimed, and only then may the
 *     minted password be revealed, because that row carries its hash;
 *   - nothing came back ⇒ somebody else's row won ⇒ re-read it and report what IT says.
 * Postgres serialises the collision for us, so two callers converge instead of one crashing, and no
 * duplicate membership is reachable — the constraint, not a prior SELECT, is the arbiter.
 *
 * Everything durable happens in ONE transaction, so a failure anywhere leaves nothing behind and the
 * seller may simply press the button again.
 */
export async function inviteStoreUser(input: {
  name: string; email: string; role: ManageableRole;
}): Promise<InviteResult> {
  const { storeId } = await requireCapability("settings:write");
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) return fail("Nama wajib diisi.");
  if (!email) return fail("Email tidak valid.");
  if (!MANAGEABLE.includes(input.role)) return fail("Peran tidak valid.");
  const role = input.role;

  let result: InviteResult;
  try {
    result = await db.transaction(async (tx): Promise<InviteResult> => {
      // ── the login account ──────────────────────────────────────────────────────────────────────
      let userId: string | undefined;
      let password: string | null = null;
      const [existing] = await tx.select({ id: schema.users.id }).from(schema.users)
        .where(eq(schema.users.email, email)).limit(1);
      if (existing) {
        userId = existing.id;
      } else {
        const temp = tempPassword();
        const [minted] = await tx.insert(schema.users)
          .values({ email, name, passwordHash: hashPassword(temp) })
          .onConflictDoNothing({ target: schema.users.email })
          .returning({ id: schema.users.id });
        if (minted) {
          userId = minted.id;
          password = temp; // ⚠️ set ONLY here: `minted` IS the row that carries this string's hash.
        } else {
          // Lost the race by microseconds. Their account and their password stand; `temp` is
          // discarded unmentioned, exactly as an existing account is — never re-hashed over theirs.
          const [raced] = await tx.select({ id: schema.users.id }).from(schema.users)
            .where(eq(schema.users.email, email)).limit(1);
          userId = raced?.id;
        }
      }
      if (!userId) return fail("Gagal menyiapkan akun. Coba lagi.");

      // ── the membership ─────────────────────────────────────────────────────────────────────────
      // `accepted_at` stays NULL. It used to be stamped `now()` right here, which made it a copy of
      // `invited_at` and left the panel unable to tell "given access, never used it" from "working
      // here" — and it asserted, in the row, that somebody had accepted an invitation at the instant
      // the OWNER pressed the button. Only the invitee can create that fact; `signIn` stamps it.
      const [member] = await tx.insert(schema.storeUsers)
        .values({ storeId, userId, role, invitedAt: new Date() })
        .onConflictDoNothing({ target: [schema.storeUsers.storeId, schema.storeUsers.userId] })
        .returning({ id: schema.storeUsers.id });
      if (member) return password ? { outcome: "created", email, role, password } : { outcome: "linked", email, role, password: null };

      // Already a member. `password` is necessarily null on this path (a `users` row this call had
      // just created could not already hold a membership), so nothing minted is being dropped.
      const [row] = await tx.select({ role: schema.storeUsers.role, invitedAt: schema.storeUsers.invitedAt, acceptedAt: schema.storeUsers.acceptedAt })
        .from(schema.storeUsers)
        .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, userId))).limit(1);
      if (!row) return fail("Gagal membaca keanggotaan. Coba lagi.");
      return row.acceptedAt
        ? { outcome: "already_accepted", email, role: row.role as StoreRole, password: null }
        : { outcome: "already_invited", email, role: row.role as StoreRole, invitedAt: row.invitedAt?.toISOString() ?? null, password: null };
    });
  } catch (e) {
    // Nothing committed, so nothing is claimed — least of all a credential. Same two-file rule as a
    // thrown error: the caller reads `outcome`, so a failure cannot render as a success.
    console.error("[users] inviteStoreUser failed", e);
    return fail("Gagal menyimpan undangan. Coba lagi.");
  }
  // Only a write changes what the page renders.
  if (result.outcome === "created" || result.outcome === "linked") revalidatePath("/pengaturan");
  return result;
}

export async function setStoreUserRole(userId: string, role: ManageableRole): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  if (!MANAGEABLE.includes(role)) return { ok: false, error: "Peran tidak valid." };
  const [row] = await db.select({ role: schema.storeUsers.role }).from(schema.storeUsers)
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, userId))).limit(1);
  if (!row) return { ok: false, error: "Anggota tidak ditemukan." };
  if (row.role === "owner") return { ok: false, error: "Peran pemilik tidak bisa diubah." };
  await db.update(schema.storeUsers).set({ role })
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, userId)));
  revalidatePath("/pengaturan");
  return { ok: true };
}

export async function removeStoreUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  const { storeId, userId: selfId } = await requireCapability("settings:write");
  if (userId === selfId) return { ok: false, error: "Anda tidak bisa mengeluarkan diri sendiri." };
  const [row] = await db.select({ role: schema.storeUsers.role }).from(schema.storeUsers)
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, userId))).limit(1);
  if (!row) return { ok: false, error: "Anggota tidak ditemukan." };
  if (row.role === "owner") return { ok: false, error: "Pemilik tidak bisa dikeluarkan." };
  // Delete only the membership — the users row may belong to other stores.
  await db.delete(schema.storeUsers)
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, userId)));
  revalidatePath("/pengaturan");
  return { ok: true };
}
