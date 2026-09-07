// POST /api/chat/read — the shopper opened the panel: clear their unread counter and stamp the
// merchant's messages as read. Same identity rules as the rest of /api/chat/* (spec §6): the
// conversation is resolved from the signed cookie + the Host-resolved store, never from the body.
import type { APIRoute } from "astro";
import { db, schema } from "@tokophi/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { LIMITS, clientIp, json, rateLimit, readVisitorToken } from "../../../lib/chat";

export const POST: APIRoute = async (ctx) => {
  const store = ctx.locals.store;
  if (!store) return json({ error: "unknown store" }, 404);

  // Same gate shape as poll.ts / send.ts. This route had none (page-map finding SF-2): a signed
  // visitor cookie is issued to anyone who sends one message, and every call here opens a
  // transaction with two UPDATEs. 429 with the same silent `{ ok: true }` the no-token path returns —
  // the panel has nothing to do with a refusal, and a stamped read is not something the shopper waits on.
  const ip = clientIp(ctx.request, ctx.clientAddress);
  if (!rateLimit(`chat:read:ip:${ip}`, LIMITS.readPerIpMin.limit, LIMITS.readPerIpMin.windowMs))
    return json({ ok: true }, 429);

  const token = await readVisitorToken(ctx, store.id);
  if (!token) return json({ ok: true });

  const [conv] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.storeId, store.id), eq(schema.conversations.visitorId, token.vid)))
    .orderBy(sql`${schema.conversations.lastMessageAt} desc`)
    .limit(1);
  if (!conv) return json({ ok: true });

  await db.transaction(async (tx) => {
    await tx
      .update(schema.conversations)
      .set({ unreadVisitor: 0 })
      .where(and(eq(schema.conversations.id, conv.id), eq(schema.conversations.storeId, store.id)));
    // read_at = when the OTHER side read it → only the merchant's messages get stamped here.
    await tx
      .update(schema.conversationMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.conversationMessages.conversationId, conv.id),
          eq(schema.conversationMessages.sender, "merchant"),
          isNull(schema.conversationMessages.readAt),
        ),
      );
  });
  return json({ ok: true });
};

export const GET: APIRoute = () => new Response("Method Not Allowed", { status: 405 });
