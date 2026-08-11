import "server-only";
import { schema } from "@tokophi/db";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";

// Allocation of the two system-generated catalog identifiers (ADR 0013). ONE definition each, because
// a number handed out twice is a catalog item pointing at the wrong product — and the ad platforms
// give no error for that, they just attribute the sale somewhere else.

/**
 * The next product number for this store. ONE statement, so two concurrent creates in the same store
 * serialise on the counter row and neither has to retry:
 *
 *   insert … on conflict do update set product_next = product_next + 1 returning product_next - 1
 *
 * A `select max(number)+1` would have been the obvious shape and is wrong under READ COMMITTED: two
 * transactions both read the same max, both write it, and either the unique fires (a save the merchant
 * cannot act on) or — without the unique — two products quietly share a catalog id.
 *
 * Gaps are fine and expected: a rolled-back create burns a number. This is an identifier, never a count.
 */
export async function allocateProductNumber(db: Tx, storeId: string): Promise<number> {
  const [row] = await db
    .insert(schema.storeCounters)
    // 1002 = "1001 is being taken right now", so the first product of a store is #1001.
    .values({ storeId, productNext: 1002 })
    .onConflictDoUpdate({
      target: schema.storeCounters.storeId,
      set: { productNext: sql`${schema.storeCounters.productNext} + 1` },
    })
    .returning({ next: schema.storeCounters.productNext });
  return Number(row.next) - 1;
}

/**
 * Reserve the next variant number for a product.
 *
 * The high-water mark lives on the product and NEVER decreases, which is the whole point: variants are
 * hard-deleted by `updateProduct`, so a `max(seq)+1` would hand a retired number to a new variant and
 * silently re-point a live Meta/Google catalog item at a different SKU.
 *
 * The UPDATE also row-locks the product for the rest of the transaction, so two concurrent edits of the
 * SAME product serialise while edits of different products never touch each other.
 *
 * ⚠️ It doubles as the CHILD-TABLE parent check. Running under `withTenant` as `tokophi_app`, RLS
 * clamps this UPDATE to the current store: a foreign `productId` matches zero rows, `returning` comes
 * back empty, and the caller must bail BEFORE writing any child row. Do not "simplify" the null check.
 */
export async function allocateVariantSeq(db: Tx, productId: string): Promise<number | null> {
  const [row] = await db
    .update(schema.products)
    .set({ variantSeqNext: sql`${schema.products.variantSeqNext} + 1`, updatedAt: new Date() })
    .where(eq(schema.products.id, productId))
    .returning({ seq: sql<number>`variant_seq_next - 1` });
  return row ? Number(row.seq) : null;
}
