import "server-only";
import { schema } from "@tokophi/db";
import { asc, desc, eq } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";

// Merchant-side support reads. RLS (migration 0035) isolates support_tickets /
// support_messages by store_id under the `tokophi_app` role — withCurrentTenant sets
// the GUC + drops the role, so the DB (not a hand-written `where`) is the boundary.
export type TicketRow = { id: string; subject: string; status: string; lastMessageAt: Date; createdAt: Date };
export type TicketMessage = { id: string; sender: string; body: string; createdAt: Date };
export type TicketDetail = { id: string; subject: string; status: string; messages: TicketMessage[] };

export async function getMyTickets(): Promise<TicketRow[]> {
  return withCurrentTenant(async (db) =>
    db
      .select({
        id: schema.supportTickets.id,
        subject: schema.supportTickets.subject,
        status: schema.supportTickets.status,
        lastMessageAt: schema.supportTickets.lastMessageAt,
        createdAt: schema.supportTickets.createdAt,
      })
      .from(schema.supportTickets)
      .orderBy(desc(schema.supportTickets.lastMessageAt)),
  );
}

export async function getTicket(id: string): Promise<TicketDetail | null> {
  return withCurrentTenant(async (db) => {
    const [t] = await db.select().from(schema.supportTickets).where(eq(schema.supportTickets.id, id)).limit(1);
    if (!t) return null;
    const messages = await db
      .select({
        id: schema.supportMessages.id,
        sender: schema.supportMessages.sender,
        body: schema.supportMessages.body,
        createdAt: schema.supportMessages.createdAt,
      })
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.ticketId, id))
      .orderBy(asc(schema.supportMessages.createdAt));
    return { id: t.id, subject: t.subject, status: t.status, messages };
  });
}
