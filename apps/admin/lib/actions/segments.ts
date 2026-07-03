"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function storeId() {
  const [s] = await db.select({ id: schema.stores.id }).from(schema.stores).limit(1);
  return s!.id;
}

export async function createSegment(input: { name: string; description: string }): Promise<string> {
  const sid = await storeId();
  const [s] = await db
    .insert(schema.customerSegments)
    .values({ storeId: sid, name: input.name.trim(), description: input.description.trim() || null, memberCount: 0, growth: 0 })
    .returning();
  revalidatePath("/pelanggan/segmen");
  return s.id;
}

export async function deleteSegment(id: string): Promise<void> {
  await db.delete(schema.customerSegments).where(eq(schema.customerSegments.id, id));
  revalidatePath("/pelanggan/segmen");
}
