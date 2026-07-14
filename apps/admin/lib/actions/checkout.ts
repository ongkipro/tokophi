"use server";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

// Record that the merchant opened WhatsApp on an abandoned cart.
//
// ⚠️ What this records, precisely: WE OPENED THE CHAT. `wa.me` is a deep link into WhatsApp — it
// hands the merchant a pre-filled message and that is the end of what we can observe. We do not know
// whether it was sent, delivered, or read, so nothing here says "terkirim": the follow-up is written
// with status `menunggu` and a `sent_at` that means "kontak dibuka", and the UI says exactly that.
// Claiming a delivery we cannot see is precisely the kind of fake number this screen exists to kill.
//
// The record lands in `followups` (type `keranjang`) — the table that was already showing cart
// follow-ups, except now the row points at a cart that exists.
export async function recordCartContact(sessionId: string): Promise<void> {
  const { storeId } = await requireCapability("crm:write");

  await withTenant(storeId, async (db) => {
    const [s] = await db
      .select()
      .from(schema.checkoutSessions)
      .where(and(eq(schema.checkoutSessions.id, sessionId), eq(schema.checkoutSessions.status, "ditinggal")))
      .limit(1);
    if (!s) throw new Error("Keranjang tidak ditemukan");
    if (!s.phone) throw new Error("Keranjang ini tidak punya nomor WhatsApp");

    const items = (s.items as Array<{ name: string; qty: number }> | null) ?? [];
    const label = items.length > 1 ? `${items[0].name} +${items.length - 1} lainnya` : items[0]?.name ?? "Keranjang";
    const now = new Date();

    await db.insert(schema.followups).values({
      storeId,
      customerId: s.customerId ?? null,
      phone: s.phone,
      type: "keranjang",
      context: `${label} · Rp${s.subtotalIdr.toLocaleString("id-ID")}`,
      dueAt: now,
      status: "menunggu", // NOT "terkirim" — we cannot observe delivery.
      sentAt: now, // = kontak dibuka
      lastMessage: null,
    });
  });

  revalidatePath("/pelanggan/keranjang");
  revalidatePath("/crm/followup");
  revalidatePath("/crm");
}
