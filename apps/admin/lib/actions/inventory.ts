"use server";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { defaultInventoryLevelId } from "@/lib/inventory-location";

// Set available stock on each product's default variant. `expected` is the value the editor loaded;
// when given, the write is OPTIMISTICALLY guarded — if the row no longer holds `expected`, a sale or
// PO changed it since the page opened, so we SKIP rather than clobber the absolute value back up
// (which silently resurrected sold units → oversell). Returns how many were written vs skipped so the
// UI can tell the merchant to reload. Targets the default-location row (not every location — the same
// broadcast bug the order path had).
export async function updateStock(
  updates: { productId: string; available: number; expected?: number }[],
): Promise<{ updated: number; skipped: number }> {
  const { storeId: sid } = await requireCapability("inventory:write");
  let updated = 0;
  let skipped = 0;
  await withTenant(sid, async (db) => {
    for (const u of updates) {
      const [v] = await db
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(and(eq(schema.productVariants.productId, u.productId), eq(schema.productVariants.position, 0)))
        .limit(1);
      if (!v) { skipped++; continue; }
      // Which row to touch (default location, this store's) — this choice doesn't change under concurrency.
      const targetId = await defaultInventoryLevelId(db, v.id, sid);
      if (!targetId) { skipped++; continue; }
      // Lock the row, then compare to `expected` — a concurrent sale can't slip between read and write.
      const [inv] = await db
        .select({ available: schema.inventoryLevels.available })
        .from(schema.inventoryLevels)
        .where(eq(schema.inventoryLevels.id, targetId))
        .for("update")
        .limit(1);
      if (!inv) { skipped++; continue; }
      if (typeof u.expected === "number" && inv.available !== u.expected) { skipped++; continue; }
      await db.update(schema.inventoryLevels).set({ available: Math.max(0, Math.round(u.available)) }).where(eq(schema.inventoryLevels.id, targetId));
      updated++;
    }
  });
  revalidatePath("/produk/inventori");
  revalidatePath("/produk");
  return { updated, skipped };
}
