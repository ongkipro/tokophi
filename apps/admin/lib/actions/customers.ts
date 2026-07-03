"use server";
import { schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export async function updateCustomer(id: string, input: { tags: string[]; notes: string }): Promise<void> {
  const { storeId: sid } = await requireCapability("customers:write");
  await withTenant(sid, (db) =>
    db
      .update(schema.customers)
      .set({ tags: input.tags, notes: input.notes.trim() || null })
      .where(eq(schema.customers.id, id)),
  );
  revalidatePath("/pelanggan");
  revalidatePath(`/pelanggan/${id}`);
}
