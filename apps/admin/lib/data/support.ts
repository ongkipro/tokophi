import "server-only";
import { schema } from "@tokophi/db";
import { asc, desc, eq } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";

// Merchant-side support reads. RLS (migration 0035) isolates support_tickets /
// support_messages by store_id under the `tokophi_app` role — withCurrentTenant sets
// the GUC + drops the role, so the DB (not a hand-written `where`) is the boundary.
// `minutesAgo` is resolved HERE, on the server, and shipped as a plain number — same contract as
// orders/activity. The client must never derive it from `Date.now()` during render: the SSR pass
// and the hydration pass would land on different sides of a minute boundary and React would blow
// up the tree (the determinism rule in CLAUDE.md).
export type TicketRow = {
  id: string;
  subject: string;
  status: string;
  lastMessageAt: Date;
  createdAt: Date;
  minutesAgo: number;
};
export type TicketMessage = { id: string; sender: string; body: string; createdAt: Date };
export type TicketDetail = { id: string; subject: string; status: string; messages: TicketMessage[] };

export async function getMyTickets(): Promise<TicketRow[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({
        id: schema.supportTickets.id,
        subject: schema.supportTickets.subject,
        status: schema.supportTickets.status,
        lastMessageAt: schema.supportTickets.lastMessageAt,
        createdAt: schema.supportTickets.createdAt,
      })
      .from(schema.supportTickets)
      .orderBy(desc(schema.supportTickets.lastMessageAt));

    // Real wall-clock (not the seeded TODAY anchor): tickets are created live by the merchant.
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      minutesAgo: Math.max(0, Math.round((now - r.lastMessageAt.getTime()) / 60_000)),
    }));
  });
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
