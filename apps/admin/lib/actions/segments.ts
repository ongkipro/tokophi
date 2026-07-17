"use server";
import { schema } from "@tokophi/db";
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

export async function updateSegment(id: string, input: { name: string; description: string }): Promise<{ ok: boolean; error?: string }> {
  const { storeId: sid } = await requireCapability("crm:write");
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nama segmen wajib diisi." };
  await withTenant(sid, (db) =>
    db.update(schema.customerSegments).set({ name, description: input.description.trim() || null }).where(eq(schema.customerSegments.id, id)),
  );
  revalidatePath("/pelanggan/segmen");
  return { ok: true };
}

export async function deleteSegment(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("crm:write");
  await withTenant(sid, (db) => db.delete(schema.customerSegments).where(eq(schema.customerSegments.id, id)));
  revalidatePath("/pelanggan/segmen");
}
