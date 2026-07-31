import { schema } from "@tokophi/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "./ledger-credit";

// ── "WHICH INVENTORY ROW DOES A STOCK CHANGE TOUCH?" — ANSWERED ONCE ─────────────────────────────
//
// This expression had FIVE hand-written copies: `actions/products.ts` (×3), `actions/purchases.ts`
// (×2), `actions/inventory.ts`, and one in raw SQL in `order-status.ts` — and only the raw one
// carried the tenant filter. Every copy is a chance to write the sixth without it, which is exactly
// the class that cost sibling call sites twice the same week (the LIKE-escape regex → `@tokophi/lib/like`,
// the UUID guard → `lib/uuid.ts`). Adding the filter to four copies would have left the class intact.
//
// 🔴 `locations.store_id = storeId` IS THE TENANT BOUNDARY — not an ordering device.
// `inventory_levels` has no `store_id`, so RLS cannot scope it at all (AGENTS.md, THE CHILD-TABLE
// RULE) — and one call path reaches here on the OWNER connection, where RLS is off entirely
// (`order-status.ts` ← `ka-tracking.ts`, the courier webhook: no session, no wrapper). The join to
// `locations` only PICKS a row; it does not prove whose row it is. Without the `store_id` predicate a
// variantId belonging to another store resolves to THEIR shelf, and `is_default desc` prefers their
// default location while doing it. Do not simplify either clause away.
//
// `desc(is_default), asc(id)`: prefer the merchant's default warehouse, then break the tie
// deterministically. An unordered `limit(1)` writes the editor's stock number into an ARBITRARY
// warehouse the moment a store has more than one location.

/**
 * The store's default location — where a NEW `inventory_levels` row is created.
 * `null` = this store has no location yet (so there is nowhere to stock anything).
 */
export async function defaultLocationId(db: Db, storeId: string): Promise<string | null> {
  const [loc] = await db
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.storeId, storeId))
    .orderBy(desc(schema.locations.isDefault), asc(schema.locations.id))
    .limit(1);
  return loc?.id ?? null;
}

/**
 * This variant's EXISTING inventory row at the store's default location.
 *
 * ⚠️ `null` is AMBIGUOUS — it means either "this store does not stock the variant yet" or "the
 * variant is not this store's at all", and the query cannot tell them apart. So `null` must be a
 * SKIP unless the caller has separately established that it owns the variant (as `updateProduct`
 * does: it reads the parent product under RLS and bails before touching any child). Inserting on
 * `null` without that proof creates an inventory row against somebody else's variant.
 */
export async function defaultInventoryLevelId(
  db: Db,
  variantId: string,
  storeId: string,
): Promise<string | null> {
  const [inv] = await db
    .select({ id: schema.inventoryLevels.id })
    .from(schema.inventoryLevels)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryLevels.locationId))
    .where(and(eq(schema.inventoryLevels.variantId, variantId), eq(schema.locations.storeId, storeId)))
    .orderBy(desc(schema.locations.isDefault), asc(schema.inventoryLevels.id))
    .limit(1);
  return inv?.id ?? null;
}
