// GET /api/chat/poll?since=<iso>,<uuid> — the shopper's read path (spec §4).
//
// Short polling with a CURSOR, not "fetch everything every 3s": one indexed query on
// (conversation_id, created_at, id), and an empty delta is ~90 bytes. The response is shaped as the
// future SSE `message` event, so upgrading to /api/chat/stream is a transport swap and nothing else.
//
// No cookie → no visitor → an empty delta (200, not 401): a shopper who has never typed has no
// thread, and that is not an error.
import type { APIRoute } from "astro";
import { db, schema } from "@tokophi/db";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  LIMITS, clientIp, cursorOf, json, parseCursor, rateLimit, readVisitorToken,
  type ChatDelta, type WireMessage,
} from "../../../lib/chat";

const EMPTY: ChatDelta = { conversationId: null, status: null, messages: [], cursor: null, unread: 0 };

export const GET: APIRoute = async (ctx) => {
  const store = ctx.locals.store;
  if (!store) return json({ error: "unknown store" }, 404);

  const ip = clientIp(ctx.request, ctx.clientAddress);
  if (!rateLimit(`chat:poll:ip:${ip}`, LIMITS.pollPerIpMin.limit, LIMITS.pollPerIpMin.windowMs))
    return json(EMPTY, 429);

  const token = await readVisitorToken(ctx, store.id);
  if (!token) return json(EMPTY);

  // The conversation is resolved FROM THE TOKEN (store_id + visitor_id). The client never gets to
  // name one — that is what makes it structurally impossible to read someone else's thread.
  const [conv] = await db
    .select({
      id: schema.conversations.id,
      status: schema.conversations.status,
      unreadVisitor: schema.conversations.unreadVisitor,
    })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.storeId, store.id), eq(schema.conversations.visitorId, token.vid)))
    .orderBy(sql`${schema.conversations.lastMessageAt} desc`)
    .limit(1);
  if (!conv) return json(EMPTY);

  const cur = parseCursor(ctx.url.searchParams.get("since"));
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
        eq(schema.conversationMessages.conversationId, conv.id),
        // Row comparison, matching the (conversation_id, created_at, id) index exactly.
        cur
          ? sql`(${schema.conversationMessages.createdAt}, ${schema.conversationMessages.id}) > (${cur.ts}::timestamptz, ${cur.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(schema.conversationMessages.createdAt), asc(schema.conversationMessages.id))
    .limit(200);

  // Only {id, sender, body, createdAt} crosses the wire — never sender_user_id, ip_hash,
  // assigned_user_id or a staff name (spec §6.4).
  const messages: WireMessage[] = rows.map((r) => ({
    id: r.id,
    sender: r.sender,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  }));

  const delta: ChatDelta = {
    conversationId: conv.id,
    status: conv.status,
    messages,
    cursor: cursorOf(messages) ?? ctx.url.searchParams.get("since"),
    unread: conv.unreadVisitor,
  };
  return json(delta);
};

export const POST: APIRoute = () => new Response("Method Not Allowed", { status: 405 });
