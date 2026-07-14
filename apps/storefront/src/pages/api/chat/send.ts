// POST /api/chat/send — the shopper's only write path (spec §4).
//
// Body: { body, name?, phone?, entryUrl?, productHandle? }
// Returns: a ChatDelta containing just the message that was written.
//
// The store comes from the Host header (src/middleware.ts → Astro.locals.store). A store id sent by
// a client is NEVER trusted. The visitor comes from the signed `tokophi_chat` cookie, minted HERE on
// the first message — not on page load, so a bot that never types leaves no row.
import type { APIRoute } from "astro";
import { db, schema } from "@tokophi/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  LIMITS, MAX_BODY, MAX_NAME, MAX_OPEN_CONVERSATIONS,
  clientIp, cursorOf, ipHash, json, mintVisitorCookie, rateLimit, readVisitorToken,
  type ChatDelta, type WireMessage,
} from "../../../lib/chat";

export const POST: APIRoute = async (ctx) => {
  const store = ctx.locals.store;
  if (!store) return json({ error: "unknown store" }, 404);

  const ip = clientIp(ctx.request, ctx.clientAddress);
  if (!rateLimit(`chat:send:ip:${ip}`, LIMITS.msgPerIpMin.limit, LIMITS.msgPerIpMin.windowMs))
    return json({ error: "Terlalu banyak pesan. Coba lagi sebentar lagi." }, 429);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await ctx.request.text());
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const body = String(payload.body ?? "").trim().slice(0, MAX_BODY);
  if (!body) return json({ error: "Pesan kosong." }, 400);
  const name = payload.name ? String(payload.name).trim().slice(0, MAX_NAME) : null;
  const phone = payload.phone ? String(payload.phone).trim().slice(0, 32) : null;
  const entryUrl = payload.entryUrl ? String(payload.entryUrl).slice(0, 300) : null;
  const productHandle = payload.productHandle ? String(payload.productHandle).slice(0, 120) : null;

  // ---- visitor: from the cookie, or minted now ----
  const token = await readVisitorToken(ctx, store.id);
  let visitorId = token?.vid ?? null;

  if (visitorId) {
    // The token is signed, but the row it points at may be gone (purge) or blocked.
    const [v] = await db
      .select({ id: schema.chatVisitors.id, status: schema.chatVisitors.status })
      .from(schema.chatVisitors)
      .where(and(eq(schema.chatVisitors.id, visitorId), eq(schema.chatVisitors.storeId, store.id)))
      .limit(1);
    if (!v) visitorId = null;
    else if (v.status === "blocked") return json({ error: "Obrolan tidak tersedia." }, 403);
  }

  if (!visitorId) {
    // A brand-new visitor is also a brand-new conversation → the stricter per-IP budget applies.
    if (!rateLimit(`chat:new:ip:${ip}`, LIMITS.newConvPerIp.limit, LIMITS.newConvPerIp.windowMs))
      return json({ error: "Terlalu banyak percakapan baru. Coba lagi nanti." }, 429);
    const [v] = await db
      .insert(schema.chatVisitors)
      .values({
        storeId: store.id,
        name,
        phone,
        ipHash: ipHash(ip),
        userAgent: (ctx.request.headers.get("user-agent") ?? "").slice(0, 300) || null,
      })
      .returning({ id: schema.chatVisitors.id });
    visitorId = v.id;
    await mintVisitorCookie(ctx, visitorId, store.id);
  }

  if (!rateLimit(`chat:send:v:${visitorId}:m`, LIMITS.msgPerVisitorMin.limit, LIMITS.msgPerVisitorMin.windowMs))
    return json({ error: "Terlalu cepat. Tunggu sebentar ya." }, 429);
  if (!rateLimit(`chat:send:v:${visitorId}:h`, LIMITS.msgPerVisitorHour.limit, LIMITS.msgPerVisitorHour.windowMs))
    return json({ error: "Batas pesan tercapai. Coba lagi nanti." }, 429);

  // Late identity: the shopper filled the Nama form on a thread they already had.
  if (name || phone) {
    await db
      .update(schema.chatVisitors)
      .set({ ...(name ? { name } : {}), ...(phone ? { phone } : {}), lastSeenAt: new Date() })
      .where(and(eq(schema.chatVisitors.id, visitorId), eq(schema.chatVisitors.storeId, store.id)));
  } else {
    await db
      .update(schema.chatVisitors)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(schema.chatVisitors.id, visitorId), eq(schema.chatVisitors.storeId, store.id)));
  }

  // ---- conversation: RESOLVED FROM THE TOKEN, never from the request (spec §6.2) ----
  const open = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.storeId, store.id),
        eq(schema.conversations.visitorId, visitorId),
        eq(schema.conversations.status, "open"),
      ),
    )
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(MAX_OPEN_CONVERSATIONS);

  let conversationId = open[0]?.id ?? null;
  if (!conversationId) {
    const [c] = await db
      .insert(schema.conversations)
      .values({ storeId: store.id, visitorId, entryUrl, productHandle })
      .returning({ id: schema.conversations.id });
    conversationId = c.id;
  }

  // ---- the message + the counters, one txn ----
  const message = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(schema.conversationMessages)
      .values({ conversationId, storeId: store.id, sender: "customer", body })
      .returning({
        id: schema.conversationMessages.id,
        sender: schema.conversationMessages.sender,
        body: schema.conversationMessages.body,
        createdAt: schema.conversationMessages.createdAt,
      });
    // +1 for the RECEIVING side — the merchant's inbox badge is one sum(), never an EXISTS scan.
    await tx
      .update(schema.conversations)
      .set({
        unreadMerchant: sql`${schema.conversations.unreadMerchant} + 1`,
        lastMessageAt: m.createdAt,
        lastMessageBody: body.slice(0, 140),
        status: "open", // a reply on a closed thread reopens it
      })
      .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.storeId, store.id)));
    return m;
  });

  const messages: WireMessage[] = [
    { id: message.id, sender: message.sender, body: message.body, createdAt: message.createdAt.toISOString() },
  ];
  const delta: ChatDelta = { conversationId, status: "open", messages, cursor: cursorOf(messages), unread: 0 };
  return json(delta);
};

export const GET: APIRoute = () => new Response("Method Not Allowed", { status: 405 });
