"use server";
import { db, schema } from "@tokophi/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";

// Merchant-side support: read/write scoped to the session's store (owner conn + explicit filter).
export type TicketRow = { id: string; subject: string; status: string; lastMessageAt: Date; createdAt: Date };
export async function getMyTickets(): Promise<TicketRow[]> {
  const session = await getSession();
  if (!session) return [];
  return db.select({ id: schema.supportTickets.id, subject: schema.supportTickets.subject, status: schema.supportTickets.status, lastMessageAt: schema.supportTickets.lastMessageAt, createdAt: schema.supportTickets.createdAt })
    .from(schema.supportTickets).where(eq(schema.supportTickets.storeId, session.storeId)).orderBy(desc(schema.supportTickets.lastMessageAt));
}

export type TicketMessage = { id: string; sender: string; body: string; createdAt: Date };
export type TicketDetail = { id: string; subject: string; status: string; messages: TicketMessage[] };
export async function getTicket(id: string): Promise<TicketDetail | null> {
  const session = await getSession();
  if (!session) return null;
  const [t] = await db.select().from(schema.supportTickets).where(and(eq(schema.supportTickets.id, id), eq(schema.supportTickets.storeId, session.storeId))).limit(1);
  if (!t) return null;
  const messages = await db.select({ id: schema.supportMessages.id, sender: schema.supportMessages.sender, body: schema.supportMessages.body, createdAt: schema.supportMessages.createdAt })
    .from(schema.supportMessages).where(eq(schema.supportMessages.ticketId, id)).orderBy(asc(schema.supportMessages.createdAt));
  return { id: t.id, subject: t.subject, status: t.status, messages };
}

export async function createTicket(subject: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  const s = subject.trim(), b = body.trim();
  if (!s || !b) return { ok: false, error: "Subjek & pesan wajib diisi." };
  const [t] = await db.insert(schema.supportTickets).values({ storeId: session.storeId, subject: s, status: "open" }).returning();
  await db.insert(schema.supportMessages).values({ ticketId: t.id, sender: "merchant", body: b });
  revalidatePath("/bantuan");
  return { ok: true, id: t.id };
}

export async function replyTicket(ticketId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sesi berakhir." };
  const b = body.trim();
  if (!b) return { ok: false, error: "Pesan kosong." };
  const [t] = await db.select({ storeId: schema.supportTickets.storeId }).from(schema.supportTickets).where(eq(schema.supportTickets.id, ticketId)).limit(1);
  if (!t || t.storeId !== session.storeId) return { ok: false, error: "Tiket tidak ditemukan." };
  await db.insert(schema.supportMessages).values({ ticketId, sender: "merchant", body: b });
  await db.update(schema.supportTickets).set({ status: "open", lastMessageAt: new Date() }).where(eq(schema.supportTickets.id, ticketId));
  revalidatePath("/bantuan"); revalidatePath(`/bantuan/${ticketId}`);
  return { ok: true };
}

export async function closeTicket(ticketId: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  await db.update(schema.supportTickets).set({ status: "closed" }).where(and(eq(schema.supportTickets.id, ticketId), eq(schema.supportTickets.storeId, session.storeId)));
  revalidatePath("/bantuan"); revalidatePath(`/bantuan/${ticketId}`);
  return { ok: true };
}
