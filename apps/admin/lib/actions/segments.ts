"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";

export async function createSegment(input: { name: string; description: string }): Promise<string> {
  const { storeId: sid } = await requireCapability("crm:write");
  const [s] = await db
    .insert(schema.customerSegments)
    .values({ storeId: sid, name: input.name.trim(), description: input.description.trim() || null, memberCount: 0, growth: 0 })
    .returning();
  revalidatePath("/pelanggan/segmen");
  return s.id;
}

export async function deleteSegment(id: string): Promise<void> {
  await requireCapability("crm:write");
  await db.delete(schema.customerSegments).where(eq(schema.customerSegments.id, id));
  revalidatePath("/pelanggan/segmen");
}
