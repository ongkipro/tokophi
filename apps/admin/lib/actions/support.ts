"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

// Merchant-side support writes. Gated by RBAC (`support:write`) and executed under the
// `tokophi_app` role via withTenant, so the RLS policies added in migration 0035 enforce
// the tenant boundary at the DB — not a hand-written `where store_id = …`.
// Reads live in lib/data/support.ts (withCurrentTenant).
//
// `allowSuspended`: a suspended (read-only) store must still be able to open a ticket —
// that is usually how it asks us to fix the very billing problem that suspended it.
const SUPPORT = { allowSuspended: true } as const;

export async function createTicket(subject: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { storeId } = await requireCapability("support:write", SUPPORT);
  const s = subject.trim(), b = body.trim();
  if (!s || !b) return { ok: false, error: "Subjek & pesan wajib diisi." };
  const id = await withTenant(storeId, async (db) => {
    const [t] = await db.insert(schema.supportTickets).values({ storeId, subject: s, status: "open" }).returning();
    await db.insert(schema.supportMessages).values({ ticketId: t.id, storeId, sender: "merchant", body: b });
    return t.id;
  });
  revalidatePath("/bantuan");
  return { ok: true, id };
}

export async function replyTicket(ticketId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("support:write", SUPPORT);
  const b = body.trim();
  if (!b) return { ok: false, error: "Pesan kosong." };
  const ok = await withTenant(storeId, async (db) => {
    // RLS scopes this select to the session's store → a foreign ticket id yields no row.
    const [t] = await db.select({ id: schema.supportTickets.id }).from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId)).limit(1);
    if (!t) return false;
    await db.insert(schema.supportMessages).values({ ticketId, storeId, sender: "merchant", body: b });
    await db.update(schema.supportTickets).set({ status: "open", lastMessageAt: new Date() }).where(eq(schema.supportTickets.id, ticketId));
    return true;
  });
  if (!ok) return { ok: false, error: "Tiket tidak ditemukan." };
  revalidatePath("/bantuan"); revalidatePath(`/bantuan/${ticketId}`);
  return { ok: true };
}

export async function closeTicket(ticketId: string): Promise<{ ok: boolean }> {
  const { storeId } = await requireCapability("support:write", SUPPORT);
  await withTenant(storeId, (db) =>
    db.update(schema.supportTickets).set({ status: "closed" }).where(eq(schema.supportTickets.id, ticketId)),
  );
  revalidatePath("/bantuan"); revalidatePath(`/bantuan/${ticketId}`);
  return { ok: true };
}
