"use server";
import { schema } from "@tokophi/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { getMessagesSince, getThreads, getUnreadTotal, type ChatMessage, type ChatThreadRow } from "@/lib/data/chat";

// Obrolan — merchant writes + the poll RPC (specs/docs/CHAT_SPEC.md §4/§5b).
//
// Gated by RBAC (`chat:write`) and executed under the `tokophi_app` role via withTenant, so the RLS
// policies from migration 0043 enforce the tenant boundary at the DB.
//
// ⚠️ DEVIATION from the spec: the merchant poll is a server action (POST RPC), not
// `app/api/chat/poll/route.ts`. The payload is byte-for-byte the one the spec designs for the SSE
// upgrade — only the door it comes through differs, and the session guard is the same.

const MAX_BODY = 2000;

/** The merchant's reply. `read_at` on the shopper's messages is stamped here too: you cannot answer
 *  a message you did not read. */
export async function sendReply(conversationId: string, body: string): Promise<{ ok: boolean; message?: ChatMessage; error?: string }> {
  const { storeId, userId } = await requireCapability("chat:write");
  const b = body.trim().slice(0, MAX_BODY);
  if (!b) return { ok: false, error: "Pesan kosong." };

  const message = await withTenant(storeId, async (db) => {
    // RLS scopes this select to the session's store → a foreign conversation id yields no row.
    const [c] = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1);
    if (!c) return null;

    const [m] = await db
      .insert(schema.conversationMessages)
      .values({ conversationId, storeId, sender: "merchant", senderUserId: userId, body: b })
      .returning({
        id: schema.conversationMessages.id,
        sender: schema.conversationMessages.sender,
        body: schema.conversationMessages.body,
        createdAt: schema.conversationMessages.createdAt,
      });

    await db
      .update(schema.conversations)
      .set({
        unreadVisitor: sql`${schema.conversations.unreadVisitor} + 1`,
        unreadMerchant: 0,
        lastMessageAt: m.createdAt,
        lastMessageBody: b.slice(0, 140),
      })
      .where(eq(schema.conversations.id, conversationId));

    await db
      .update(schema.conversationMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.conversationMessages.conversationId, conversationId),
          eq(schema.conversationMessages.sender, "customer"),
          isNull(schema.conversationMessages.readAt),
        ),
      );
    return m;
  });

  if (!message) return { ok: false, error: "Obrolan tidak ditemukan." };
  revalidatePath("/obrolan");
  return { ok: true, message: { ...message, createdAt: message.createdAt.toISOString() } };
}

/** The merchant opened a thread → clear its badge. A read is not a write to the store's data in the
 *  billing sense, so this deliberately uses `chat:read`… but it IS a mutation, so it still goes
 *  through requireCapability with the suspension check waived. */
export async function markThreadRead(conversationId: string): Promise<{ ok: boolean }> {
  const { storeId } = await requireCapability("chat:read", { allowSuspended: true });
  await withTenant(storeId, (db) =>
    db.update(schema.conversations).set({ unreadMerchant: 0 }).where(eq(schema.conversations.id, conversationId)),
  );
  revalidatePath("/obrolan");
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Poll. A CURSOR, not "fetch everything every 5s": the thread delta is one indexed query on
// (conversation_id, created_at, id), the inbox delta is one indexed query on
// (store_id, last_message_at desc) bounded by `since`. Empty deltas are ~60 bytes.
//
// The payload is shaped as the future SSE `message` event (spec §4) — upgrading is a transport
// swap, no schema/payload/UI change.
// ---------------------------------------------------------------------------------------------
export type ChatPoll = {
  messages: ChatMessage[];
  cursor: string | null;
  threads: ChatThreadRow[];
  unreadTotal: number;
};

export async function pollChat(input: {
  conversationId?: string | null;
  since?: string | null; // message cursor "<iso>,<uuid>"
  inboxSince?: string | null; // ISO — only threads touched after this come back
}): Promise<ChatPoll> {
  const messages = input.conversationId ? await getMessagesSince(input.conversationId, input.since ?? null) : [];
  const threads = await getThreads(input.inboxSince ?? undefined);
  const last = messages[messages.length - 1];
  return {
    messages,
    cursor: last ? `${last.createdAt},${last.id}` : (input.since ?? null),
    threads,
    unreadTotal: await getUnreadTotal(),
  };
}
