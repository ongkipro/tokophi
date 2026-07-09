"use server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";

export type Profile = { name: string; email: string; role: string; storeName: string; joinedDaysAgo: number | null };

export async function getProfile(): Promise<Profile | null> {
  const session = await getSession();
  if (!session) return null;
  const [u] = await db
    .select({ name: schema.users.name, email: schema.users.email, createdAt: schema.users.createdAt })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!u) return null;
  const [st] = await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, session.storeId)).limit(1);
  const joinedDaysAgo = u.createdAt ? Math.round((Date.now() - new Date(u.createdAt).getTime()) / 86_400_000) : null;
  return { name: u.name ?? "", email: u.email, role: session.role, storeName: st?.name ?? "", joinedDaysAgo };
}

export async function updateProfile(input: { name: string; email: string }): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  if (!name) return { ok: false, error: "Nama wajib diisi." };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Format email tidak valid." };
  const [dup] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (dup && dup.id !== session.userId) return { ok: false, error: "Email sudah dipakai pengguna lain." };
  await db.update(schema.users).set({ name, email }).where(eq(schema.users.id, session.userId));
  revalidatePath("/pengaturan/profil");
  return { ok: true };
}
