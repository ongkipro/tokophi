import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";
import type { InventoryReceiptFact } from "./inventory";

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: Sql;
let db: PostgresJsDatabase;
let inventoryReceiptFactsForStore: (
  db: Tx,
  storeId: string,
) => Promise<Record<string, InventoryReceiptFact>>;

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL;
  // Dynamic by design: @tokophi/db binds DATABASE_URL at module evaluation time.
  ({ inventoryReceiptFactsForStore } = await import("./inventory"));
  client = postgres(URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" });
});

afterAll(async () => {
  if (client) await client.end();
});

class Rollback extends Error {}

async function inTxn(fn: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

let seq = 0;

async function mkStore(tx: Tx): Promise<string> {
  const [account] = await tx.execute<{ id: string }>(
    sql`insert into accounts (name) values ('Inventory receipt test') returning id`,
  );
  const [store] = await tx.execute<{ id: string }>(
    sql`insert into stores (account_id, name, slug)
        values (${account.id}, 'Inventory receipt test', ${`inventory-receipt-${++seq}`})
        returning id`,
  );
  return store.id;
}

async function mkProduct(
  tx: Tx,
  storeId: string,
  variantStoreId = storeId,
): Promise<{ productId: string; variantId: string }> {
  const n = ++seq;
  const [product] = await tx.execute<{ id: string }>(
    sql`insert into products (store_id, title, handle, number)
        values (${storeId}, ${`Product ${n}`}, ${`product-${n}`}, ${n})
        returning id`,
  );
  const [variant] = await tx.execute<{ id: string }>(
    sql`insert into product_variants (product_id, store_id, sku, price_idr, seq)
        values (${product.id}, ${variantStoreId}, ${`RECEIPT-${n}`}, 1000, 1)
        returning id`,
  );
  return { productId: product.id, variantId: variant.id };
}

async function mkPurchaseOrder(
  tx: Tx,
  storeId: string,
  status: "draft" | "dipesan" | "sebagian" | "diterima",
): Promise<string> {
  const [purchaseOrder] = await tx.execute<{ id: string }>(
    sql`insert into purchase_orders (store_id, code, status)
        values (${storeId}, ${`PO-RECEIPT-${++seq}`}, ${status}::po_status)
        returning id`,
  );
  return purchaseOrder.id;
}

async function mkLine(
  tx: Tx,
  purchaseOrderId: string,
  variantId: string,
  qty: number,
  receivedQty: number,
) {
  await tx.execute(
    sql`insert into purchase_order_items (purchase_order_id, variant_id, qty, received_qty)
        values (${purchaseOrderId}, ${variantId}, ${qty}, ${receivedQty})`,
  );
}

suite("inventoryReceiptFactsForStore", () => {
  it("reports waiting, partial, full, and absent receipt states from tenant-owned open POs", async () => {
    await inTxn(async (tx) => {
      const storeA = await mkStore(tx);
      const storeB = await mkStore(tx);
      const waiting = await mkProduct(tx, storeA);
      const partial = await mkProduct(tx, storeA);
      const full = await mkProduct(tx, storeA);
      const lineScoped = await mkProduct(tx, storeA);
      const noOpenReceipt = await mkProduct(tx, storeA);
      const foreign = await mkProduct(tx, storeB);
      const mismatchedVariantOwner = await mkProduct(tx, storeA, storeB);

      const orderedPo = await mkPurchaseOrder(tx, storeA, "dipesan");
      const partialPo = await mkPurchaseOrder(tx, storeA, "sebagian");
      const completedPo = await mkPurchaseOrder(tx, storeA, "diterima");
      const draftPo = await mkPurchaseOrder(tx, storeA, "draft");
      const foreignPo = await mkPurchaseOrder(tx, storeB, "dipesan");

      await mkLine(tx, orderedPo, waiting.variantId, 10, 0);
      await mkLine(tx, partialPo, partial.variantId, 10, 4);
      await mkLine(tx, partialPo, full.variantId, 7, 7);
      await mkLine(tx, partialPo, lineScoped.variantId, 5, 7);
      await mkLine(tx, partialPo, lineScoped.variantId, 5, 0);
      await mkLine(tx, completedPo, noOpenReceipt.variantId, 8, 8);
      await mkLine(tx, draftPo, noOpenReceipt.variantId, 9, 0);

      // Both directions are possible because purchase_order_items carries no store_id.
      await mkLine(tx, foreignPo, waiting.variantId, 100, 50);
      await mkLine(tx, partialPo, foreign.variantId, 100, 0);
      await mkLine(tx, partialPo, mismatchedVariantOwner.variantId, 100, 0);

      const facts = await inventoryReceiptFactsForStore(tx, storeA);

      expect(facts[waiting.productId]).toEqual({
        ordered: 10,
        received: 0,
        incoming: 10,
      });
      expect(facts[partial.productId]).toEqual({
        ordered: 10,
        received: 4,
        incoming: 6,
      });
      expect(facts[full.productId]).toEqual({
        ordered: 7,
        received: 7,
        incoming: 0,
      });
      expect(facts[lineScoped.productId]).toEqual({
        ordered: 10,
        received: 7,
        incoming: 5,
      });
      expect(facts[noOpenReceipt.productId]).toBeUndefined();
      expect(facts[foreign.productId]).toBeUndefined();
      expect(facts[mismatchedVariantOwner.productId]).toBeUndefined();
      expect(Object.keys(facts)).toHaveLength(4);
    });
  });
});
