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

export type StoreRole = "owner" | "admin" | "staff" | "gudang";
export type ManageableRole = "admin" | "staff" | "gudang";
export type StoreUserRow = { userId: string; name: string; email: string; role: StoreRole; isSelf: boolean };

const MANAGEABLE: ManageableRole[] = ["admin", "staff", "gudang"];

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
      }))
      .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.name.localeCompare(b.name)));
  });
}

export async function inviteStoreUser(input: {
  name: string; email: string; role: ManageableRole;
}): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
  const { storeId } = await requireCapability("settings:write");
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) return { ok: false, error: "Nama wajib diisi." };
  if (!email) return { ok: false, error: "Email tidak valid." };
  if (!MANAGEABLE.includes(input.role)) return { ok: false, error: "Peran tidak valid." };

  let temp: string | undefined;
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    let userId = existing?.id;
    if (!userId) {
      temp = tempPassword();
      const [created] = await tx.insert(schema.users).values({ email, name, passwordHash: hashPassword(temp) }).returning({ id: schema.users.id });
      userId = created.id;
    }
    const [member] = await tx.select({ id: schema.storeUsers.id }).from(schema.storeUsers)
      .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.userId, userId))).limit(1);
    if (member) return { ok: false as const, error: "Pengguna ini sudah menjadi anggota toko." };
    const now = new Date();
    await tx.insert(schema.storeUsers).values({ storeId, userId, role: input.role, invitedAt: now, acceptedAt: now });
    return { ok: true as const };
  });
  if (!result.ok) return result;
  revalidatePath("/pengaturan");
  return { ok: true, tempPassword: temp };
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
