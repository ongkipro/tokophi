"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { normalizePhone } from "@tokophi/lib/validate";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

// Merchant logs a customer by hand (a WA order, a walk-in). registeredAt stays NULL — a hand-added
// customer is a guest like any other (0044); an account only exists when the shopper made one.
export async function createCustomer(input: {
  name: string; email: string; phone: string; city: string; province: string;
}): Promise<void> {
  const { storeId: sid } = await requireCapability("customers:write");
  const name = input.name.trim();
  if (!name) throw new Error("Nama pelanggan wajib diisi.");
  let phone: string | null = null;
  if (input.phone.trim()) {
    phone = normalizePhone(input.phone);
    if (!phone) throw new Error("Nomor WhatsApp tidak valid.");
  }
  await withTenant(sid, (db) =>
    db.insert(schema.customers).values({
      storeId: sid,
      name,
      email: input.email.trim() || null,
      phone,
      city: input.city.trim() || null,
      province: input.province.trim() || null,
    }),
  );
  revalidatePath("/pelanggan");
}

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
