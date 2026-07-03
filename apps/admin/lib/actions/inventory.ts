"use server";
import { db, schema } from "@indostore/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";

// Set available stock on each product's default variant.
export async function updateStock(updates: { productId: string; available: number }[]): Promise<void> {
  await requireCapability("inventory:write");
  for (const u of updates) {
    const [v] = await db
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(and(eq(schema.productVariants.productId, u.productId), eq(schema.productVariants.position, 0)))
      .limit(1);
    if (v) {
      await db
        .update(schema.inventoryLevels)
        .set({ available: Math.max(0, Math.round(u.available)) })
        .where(eq(schema.inventoryLevels.variantId, v.id));
    }
  }
  revalidatePath("/produk/inventori");
  revalidatePath("/produk");
}
