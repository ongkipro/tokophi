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
