"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function updateCustomer(id: string, input: { tags: string[]; notes: string }): Promise<void> {
  await db
    .update(schema.customers)
    .set({ tags: input.tags, notes: input.notes.trim() || null })
    .where(eq(schema.customers.id, id));
  revalidatePath("/pelanggan");
  revalidatePath(`/pelanggan/${id}`);
}
