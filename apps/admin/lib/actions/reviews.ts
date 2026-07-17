"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

// Ulasan moderation. A review shows on the storefront ONLY when status='terbit' (catalog.ts filters on
// it), so publishing/hiding here is what actually governs what a shopper sees — content:write is the
// gate (a review is storefront content). Store-scoped via withTenant so a forged id can't touch
// another store's reviews.

export async function setReviewStatus(id: string, status: "terbit" | "menunggu"): Promise<{ ok: boolean }> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, (db) => db.update(schema.reviews).set({ status }).where(eq(schema.reviews.id, id)));
  revalidatePath("/pelanggan/ulasan");
  return { ok: true };
}

export async function deleteReview(id: string): Promise<{ ok: boolean }> {
  const { storeId: sid } = await requireCapability("content:write");
  await withTenant(sid, (db) => db.delete(schema.reviews).where(eq(schema.reviews.id, id)));
  revalidatePath("/pelanggan/ulasan");
  return { ok: true };
}

// The seller's public reply. Empty string clears it (back to NULL = not replied). Shows on the PDP
// under the review (data/catalog.ts productReviews), so it only reaches a shopper once the review
// itself is status='terbit'. revalidate the storefront? No — the storefront reads at SSR per request.
export async function replyToReview(id: string, reply: string): Promise<{ ok: boolean }> {
  const { storeId: sid } = await requireCapability("content:write");
  const trimmed = reply.trim();
  await withTenant(sid, (db) =>
    db.update(schema.reviews).set({ reply: trimmed || null }).where(eq(schema.reviews.id, id)),
  );
  revalidatePath("/pelanggan/ulasan");
  return { ok: true };
}
