"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// Anchored to the seed's frame so derived status (getDiscount) round-trips.
const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");
const DAY = 86_400_000;
const KIND = { persen: "persen", nominal: "nominal", ongkir: "gratis_ongkir" } as const;

export type DiscountInput = {
  code: string;
  type: "persen" | "nominal" | "ongkir";
  value: number;
  limit?: number | null;
  status: "aktif" | "terjadwal";
  period: number; // days until it ends
};

async function storeId() {
  const [s] = await db.select({ id: schema.stores.id }).from(schema.stores).limit(1);
  return s!.id;
}

function fields(i: DiscountInput) {
  const days = Math.max(1, i.period || 0);
  const startsAt = i.status === "terjadwal" ? new Date(ADMIN_TODAY.getTime() + 2 * DAY) : new Date(ADMIN_TODAY.getTime() - DAY);
  const endsAt = new Date(startsAt.getTime() + days * DAY);
  return {
    code: i.code.trim().toUpperCase(),
    kind: KIND[i.type],
    value: i.type === "ongkir" ? 0 : Math.max(0, i.value || 0),
    usageLimit: i.limit && i.limit > 0 ? i.limit : null,
    startsAt,
    endsAt,
    status: i.status,
  };
}

export async function createDiscount(input: DiscountInput): Promise<string> {
  const sid = await storeId();
  const [d] = await db.insert(schema.discounts).values({ storeId: sid, ...fields(input) }).returning();
  revalidatePath("/diskon");
  return d.id;
}

export async function updateDiscount(id: string, input: DiscountInput): Promise<void> {
  await db.update(schema.discounts).set(fields(input)).where(eq(schema.discounts.id, id));
  revalidatePath("/diskon");
  revalidatePath(`/diskon/${id}`);
}

export async function deleteDiscount(id: string): Promise<void> {
  await db.delete(schema.discountUsages).where(eq(schema.discountUsages.discountId, id));
  await db.delete(schema.discounts).where(eq(schema.discounts.id, id));
  revalidatePath("/diskon");
}
