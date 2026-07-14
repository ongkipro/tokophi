import "server-only";
import { schema } from "@tokophi/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac-policy";

// Obrolan — the MERCHANT side of shopper ⇄ merchant chat (specs/docs/CHAT_SPEC.md §5b).
//
// RLS (migration 0043) isolates conversations / conversation_messages / chat_visitors by store_id
// under the `tokophi_app` role — withCurrentTenant sets the GUC and drops the role, so the DB is the
// tenant boundary, not a hand-written `where store_id = …`. (The storefront's shopper API is the
// deliberate owner-connection exception: an anonymous shopper has no session and therefore no GUC.)
//
// `minutesAgo` is computed HERE, on the server, and shipped as a plain number — the client must
// never derive it from Date.now() during render (the determinism rule in CLAUDE.md: SSR and
// hydration would land on different sides of a minute boundary).

/** Read guard. `requireCapability` is for MUTATIONS — it also throws when the subscription is
 *  read-only, which must not stop a merchant from *reading* their inbox. */
export async function requireChatRead(): Promise<{ storeId: string; userId: string; role: string }> {
  const session = await getSession();
  if (!session || !can(session.role, "chat:read")) throw new Error("Akses ditolak — tidak punya izin “chat:read”.");
  return session;
}

export async function canReadChat(): Promise<boolean> {
  const session = await getSession();
  return !!session && can(session.role, "chat:read");
}

export type ChatThreadRow = {
  id: string;
  visitorName: string | null;
  status: "open" | "snoozed" | "closed";
  preview: string | null;
  unread: number;
  lastMessageAt: string; // ISO — the inbox poll cursor
  minutesAgo: number;
  productHandle: string | null;
  isCustomer: boolean;
  orderNumber: string | null;
};

export type ChatMessage = {
  id: string;
  sender: "customer" | "merchant" | "system";
  body: string;
  createdAt: string; // ISO
};

export type ChatThread = {
  id: string;
  visitorName: string | null;
  visitorPhone: string | null;
  status: "open" | "snoozed" | "closed";
  entryUrl: string | null;
  productHandle: string | null;
  orderNumber: string | null;
  customerId: string | null;
  messages: ChatMessage[];
};

const rowShape = {
  id: schema.conversations.id,
  status: schema.conversations.status,
  preview: schema.conversations.lastMessageBody,
  unread: schema.conversations.unreadMerchant,
  lastMessageAt: schema.conversations.lastMessageAt,
  productHandle: schema.conversations.productHandle,
  customerId: schema.conversations.customerId,
  visitorName: schema.chatVisitors.name,
  orderNumber: schema.orders.number,
};

const toRow = (r: {
  id: string; status: "open" | "snoozed" | "closed"; preview: string | null; unread: number;
  lastMessageAt: Date; productHandle: string | null; customerId: string | null;
  visitorName: string | null; orderNumber: string | null;
}, now: number): ChatThreadRow => ({
  id: r.id,
  visitorName: r.visitorName,
  status: r.status,
  preview: r.preview,
  unread: r.unread,
  lastMessageAt: r.lastMessageAt.toISOString(),
  minutesAgo: Math.max(0, Math.round((now - r.lastMessageAt.getTime()) / 60_000)),
  productHandle: r.productHandle,
  isCustomer: !!r.customerId,
  orderNumber: r.orderNumber,
});

/** The inbox. `since` (ISO) makes the 5s poll a DELTA, not a full refetch of every thread. */
export async function getThreads(since?: string): Promise<ChatThreadRow[]> {
  await requireChatRead();
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select(rowShape)
      .from(schema.conversations)
      .innerJoin(schema.chatVisitors, eq(schema.chatVisitors.id, schema.conversations.visitorId))
      .leftJoin(schema.orders, eq(schema.orders.id, schema.conversations.orderId))
      // ISO string + an explicit cast: a bare JS Date bound into a raw `sql` fragment carries no
      // type for postgres.js and blows up in Buffer.byteLength.
      .where(since ? sql`${schema.conversations.lastMessageAt} > ${new Date(since).toISOString()}::timestamptz` : undefined)
      .orderBy(desc(schema.conversations.lastMessageAt))
      .limit(100);
    const now = Date.now();
    return rows.map((r) => toRow(r, now));
  });
}

/** The unread badge: one sum() over a counter, never an EXISTS scan per row. */
export async function getUnreadTotal(): Promise<number> {
  await requireChatRead();
  return withCurrentTenant(async (db) => {
    const [r] = await db
      .select({ total: sql<number>`coalesce(sum(${schema.conversations.unreadMerchant}), 0)::int` })
      .from(schema.conversations);
    return r?.total ?? 0;
  });
}

export async function getThread(id: string): Promise<ChatThread | null> {
  await requireChatRead();
  return withCurrentTenant(async (db) => {
    // RLS scopes this to the session's store → a foreign conversation id simply yields no row.
    const [c] = await db
      .select({
        id: schema.conversations.id,
        status: schema.conversations.status,
        entryUrl: schema.conversations.entryUrl,
        productHandle: schema.conversations.productHandle,
        customerId: schema.conversations.customerId,
        visitorName: schema.chatVisitors.name,
        visitorPhone: schema.chatVisitors.phone,
        orderNumber: schema.orders.number,
      })
      .from(schema.conversations)
      .innerJoin(schema.chatVisitors, eq(schema.chatVisitors.id, schema.conversations.visitorId))
      .leftJoin(schema.orders, eq(schema.orders.id, schema.conversations.orderId))
      .where(eq(schema.conversations.id, id))
      .limit(1);
    if (!c) return null;
    const messages = await getMessagesTx(db, id, null);
    return { ...c, messages };
  });
}

/** Cursor read — `(created_at, id) > (ts, id)`, hitting conversation_messages_conv_created_idx.
 *  `id` breaks ties so a reply written in the same millisecond can never be skipped. */
export async function getMessagesSince(conversationId: string, since: string | null): Promise<ChatMessage[]> {
  await requireChatRead();
  return withCurrentTenant(async (db) => getMessagesTx(db, conversationId, since));
}

type Db = Parameters<Parameters<typeof withCurrentTenant>[0]>[0];

async function getMessagesTx(db: Db, conversationId: string, since: string | null): Promise<ChatMessage[]> {
  const [iso, cursorId] = (since ?? "").split(",");
  const parsed = new Date(iso ?? "");
  const useCursor = !!cursorId && !Number.isNaN(parsed.getTime());
  const ts = useCursor ? parsed.toISOString() : "";
  const rows = await db
    .select({
      id: schema.conversationMessages.id,
      sender: schema.conversationMessages.sender,
      body: schema.conversationMessages.body,
      createdAt: schema.conversationMessages.createdAt,
    })
    .from(schema.conversationMessages)
    .where(
      and(
        eq(schema.conversationMessages.conversationId, conversationId),
        useCursor
          ? sql`(${schema.conversationMessages.createdAt}, ${schema.conversationMessages.id}) > (${ts}::timestamptz, ${cursorId}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(schema.conversationMessages.createdAt), asc(schema.conversationMessages.id))
    .limit(200);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
