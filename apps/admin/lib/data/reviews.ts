import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { desc, eq } from "drizzle-orm";
import type { Review } from "@/lib/types/domain";

// ⚠️ THE REAL CLOCK. This was `ADMIN_TODAY = 2026-06-30`, the seed's frame, so anything created or
// touched after the seed was written rendered a NEGATIVE age. The seed may be anchored; the app is not.

export async function getReviews(): Promise<Review[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({
        id: schema.reviews.id,
        customer: schema.customers.name,
        product: schema.reviews.productName,
        emoji: schema.reviews.emoji,
        rating: schema.reviews.rating,
        body: schema.reviews.body,
        reply: schema.reviews.reply,
        status: schema.reviews.status,
        createdAt: schema.reviews.createdAt,
      })
      .from(schema.reviews)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.reviews.customerId))
      .orderBy(desc(schema.reviews.createdAt));
    return rows.map((r) => ({
      id: r.id,
      customer: r.customer ?? "—",
      product: r.product ?? "",
      emoji: r.emoji ?? "⭐",
      rating: r.rating,
      text: r.body ?? "",
      reply: r.reply ?? "",
      status: r.status,
      daysAgo: Math.round((Date.now() - r.createdAt.getTime()) / 86_400_000),
    }));
  });
}
