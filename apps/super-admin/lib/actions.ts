"use server";
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, signSession } from "./session";

// NOTE: the super-admin currently has no auth of its own (local control plane). These actions
// therefore run unguarded — before any real deployment, gate them behind a platform-admin
// session. Tracked as a follow-up.

const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3000";

// Impersonate a store's owner: mint the admin session cookie (host-scoped to localhost, so it
// reaches :3000) and hand back the admin URL for the client to open.
export async function impersonateStore(storeId: string): Promise<{ ok: boolean; adminUrl?: string; error?: string }> {
  const [owner] = await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      storeId: schema.storeUsers.storeId,
      role: schema.storeUsers.role,
    })
    .from(schema.storeUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.storeUsers.userId))
    .where(and(eq(schema.storeUsers.storeId, storeId), eq(schema.storeUsers.role, "owner")))
    .limit(1);

  if (!owner) return { ok: false, error: "Toko tidak punya pemilik (owner) untuk dibukakan panelnya." };

  const token = await signSession({
    userId: owner.userId,
    storeId: owner.storeId,
    role: owner.role,
    email: owner.email,
    name: owner.name ?? owner.email,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return { ok: true, adminUrl: ADMIN_URL };
}

export async function setStoreStatus(storeId: string, status: "active" | "trial" | "suspended"): Promise<void> {
  await db.update(schema.stores).set({ status }).where(eq(schema.stores.id, storeId));
  revalidatePath("/toko");
  revalidatePath(`/toko/${storeId}`);
  revalidatePath("/");
}

export async function setStorePlan(storeId: string, plan: "pemula" | "bisnis" | "skala"): Promise<void> {
  await db.update(schema.stores).set({ plan }).where(eq(schema.stores.id, storeId));
  // keep the account tier in sync (billing is per-account)
  const [s] = await db.select({ accountId: schema.stores.accountId }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (s) await db.update(schema.accounts).set({ plan }).where(eq(schema.accounts.id, s.accountId));
  revalidatePath("/toko");
  revalidatePath(`/toko/${storeId}`);
  revalidatePath("/");
}
