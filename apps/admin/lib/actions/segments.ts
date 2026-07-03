"use server";
import { schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export async function createSegment(input: { name: string; description: string }): Promise<string> {
  const { storeId: sid } = await requireCapability("crm:write");
  const id = await withTenant(sid, async (db) => {
    const [s] = await db
      .insert(schema.customerSegments)
      .values({ storeId: sid, name: input.name.trim(), description: input.description.trim() || null, memberCount: 0, growth: 0 })
      .returning();
    return s.id;
  });
  revalidatePath("/pelanggan/segmen");
  return id;
}

export async function deleteSegment(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("crm:write");
  await withTenant(sid, (db) => db.delete(schema.customerSegments).where(eq(schema.customerSegments.id, id)));
  revalidatePath("/pelanggan/segmen");
}
