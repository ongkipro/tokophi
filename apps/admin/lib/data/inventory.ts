import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { and, eq, inArray, sql } from "drizzle-orm";

export type InventoryReceiptFact = {
  ordered: number;
  received: number;
  incoming: number;
};

export async function inventoryReceiptFactsForStore(
  db: Tx,
  storeId: string,
): Promise<Record<string, InventoryReceiptFact>> {
  const rows = await db
    .select({
      productId: schema.productVariants.productId,
      ordered: sql<number>`coalesce(sum(${schema.purchaseOrderItems.qty}), 0)`.mapWith(Number),
      received:
        sql<number>`coalesce(sum(${schema.purchaseOrderItems.receivedQty}), 0)`.mapWith(Number),
      // Outstanding is line-scoped. An over-received line must not hide an unreceived sibling line.
      incoming:
        sql<number>`coalesce(sum(greatest(${schema.purchaseOrderItems.qty} - ${schema.purchaseOrderItems.receivedQty}, 0)), 0)`.mapWith(
          Number,
        ),
    })
    .from(schema.purchaseOrderItems)
    .innerJoin(
      schema.purchaseOrders,
      eq(schema.purchaseOrders.id, schema.purchaseOrderItems.purchaseOrderId),
    )
    .innerJoin(
      schema.productVariants,
      eq(schema.productVariants.id, schema.purchaseOrderItems.variantId),
    )
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(
      and(
        eq(schema.purchaseOrders.storeId, storeId),
        eq(schema.productVariants.storeId, storeId),
        eq(schema.products.storeId, storeId),
        inArray(schema.purchaseOrders.status, ["dipesan", "sebagian"]),
      ),
    )
    .groupBy(schema.productVariants.productId);

  return Object.fromEntries(
    rows.map(({ productId, ...fact }) => [productId, fact]),
  );
}

export async function getInventoryReceiptFacts(): Promise<
  Record<string, InventoryReceiptFact>
> {
  return withCurrentTenant(inventoryReceiptFactsForStore);
}
