"use server";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { defaultLocationId } from "@/lib/inventory-location";
import { isUuid } from "@/lib/uuid";

type StockUpdate = {
  variantId: string;
  available: number;
  expected: number;
};

type StockUpdateResult = {
  updated: string[];
  stale: { variantId: string; available: number }[];
  missing: string[];
  invalid: string[];
};

export async function updateStock(
  updates: StockUpdate[],
): Promise<StockUpdateResult> {
  const { storeId } = await requireCapability("inventory:write");
  const result: StockUpdateResult = {
    updated: [],
    stale: [],
    missing: [],
    invalid: [],
  };

  await withTenant(storeId, async (db) => {
    const locationId = await defaultLocationId(db, storeId);

    for (const update of updates) {
      const { variantId, available, expected } = update;
      if (
        !isUuid(variantId) ||
        !Number.isFinite(available) ||
        !Number.isInteger(available) ||
        available < 0 ||
        !Number.isFinite(expected) ||
        !Number.isInteger(expected) ||
        expected < 0
      ) {
        result.invalid.push(variantId);
        continue;
      }

      // `inventory_levels` has no store_id or RLS. This explicit variant read is the tenant
      // boundary: no child inventory row is resolved or written until ownership is proven.
      const [ownedVariant] = await db
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.id, variantId),
            eq(schema.productVariants.storeId, storeId),
          ),
        )
        .limit(1);
      if (!ownedVariant || !locationId) {
        result.missing.push(variantId);
        continue;
      }

      // Resolve this variant at exactly the store's default location. Locking the row makes the
      // expected-value comparison and the absolute update one atomic decision against concurrent
      // sales, receipts, and inventory edits.
      const [inventory] = await db
        .select({
          id: schema.inventoryLevels.id,
          available: schema.inventoryLevels.available,
        })
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.variantId, ownedVariant.id),
            eq(schema.inventoryLevels.locationId, locationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!inventory) {
        result.missing.push(variantId);
        continue;
      }
      if (inventory.available !== expected) {
        result.stale.push({ variantId, available: inventory.available });
        continue;
      }

      await db
        .update(schema.inventoryLevels)
        .set({ available })
        .where(eq(schema.inventoryLevels.id, inventory.id));
      result.updated.push(variantId);
    }
  });

  revalidatePath("/produk/inventori");
  revalidatePath("/produk");
  return result;
}
