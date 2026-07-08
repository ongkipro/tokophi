"use server";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

// Set available stock on each product's default variant.
export async function updateStock(updates: { productId: string; available: number }[]): Promise<void> {
  const { storeId: sid } = await requireCapability("inventory:write");
  await withTenant(sid, async (db) => {
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
  });
  revalidatePath("/produk/inventori");
  revalidatePath("/produk");
}
