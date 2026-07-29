import { db, schema } from "@tokophi/db";
import { and, eq, ne, sql } from "drizzle-orm";

// Products on an ACTIVE flash sale RIGHT NOW → productId → sale price (IDR). Owner connection with an
// EXPLICIT store scope, same as the rest of /api/public/order (the storefront has no session). "Active"
// = the sale row is `aktif` AND the DB clock is inside [starts_at, ends_at) — the window is evaluated
// with `now()` so the clock alone flips a sale on and off; nothing is stored as "is it live".
//
// This is the ONE place the storefront's advertised sale price becomes money: the order API applies the
// returned price ONLY when it is below the variant's base price (a sale never raises a price), exactly
// like the shipping quote is the one place ongkir becomes money.
export async function activeFlashPrices(storeId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ productId: schema.flashSaleItems.productId, price: schema.flashSaleItems.salePriceIdr })
    .from(schema.flashSaleItems)
    .innerJoin(schema.flashSales, eq(schema.flashSales.id, schema.flashSaleItems.flashSaleId))
    .where(
      and(
        eq(schema.flashSales.storeId, storeId),
        // `nonaktif` is OFF; the window below IS the schedule. Must match the storefront reader in
        // apps/storefront/src/data/catalog.ts — the two price the same parcel.
        ne(schema.flashSales.status, "nonaktif"),
        sql`now() >= ${schema.flashSales.startsAt}`,
        sql`now() < ${schema.flashSales.endsAt}`,
      ),
    );
  const m = new Map<string, number>();
  // A product in two overlapping sales → the LOWER price wins (never overcharge the shopper).
  for (const r of rows) {
    const prev = m.get(r.productId);
    m.set(r.productId, prev == null ? r.price : Math.min(prev, r.price));
  }
  return m;
}
