import "server-only";
import { db, schema } from "@indostore/db";
import { desc, eq } from "drizzle-orm";
import type { Review } from "@/lib/mock/store";

const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");

export async function getReviews(): Promise<Review[]> {
  const rows = await db
    .select({
      id: schema.reviews.id,
      customer: schema.customers.name,
      product: schema.reviews.productName,
      emoji: schema.reviews.emoji,
      rating: schema.reviews.rating,
      body: schema.reviews.body,
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
    status: r.status,
    daysAgo: Math.round((ADMIN_TODAY.getTime() - r.createdAt.getTime()) / 86_400_000),
  }));
}
