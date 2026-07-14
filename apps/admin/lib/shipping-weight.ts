import "server-only";
import { schema } from "@tokophi/db";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";

// ─────────────────────────────────────────────────────────────────────────────
// Package weight — computed from the SELLER'S data, never from the buyer's.
//
// The checkout used to price every parcel with `weight: totalQty * 500` — a number invented in the
// shopper's browser. Two things were wrong with it, and both cost money:
//   1. It was fiction. `product_variants.weight_grams` has existed since the first schema and the
//      product editor has always had a required "Berat (gram)" field, but the quote never read it.
//      A real 675 g apparel cart was quoted as a 3.000 g parcel: Rp41.100 instead of Rp13.700 on
//      Surabaya → Mampang Prapatan (SPX Standard). 3× the true postage, silently, on every order.
//   2. It was CLIENT-SUPPLIED. Weight is a PRICE INPUT. A script posting `weight: 100` for a 5 kg
//      parcel gets the cheap quote and the merchant eats the difference with the courier — the same
//      class of bug as the client-posted ongkir ORIGIN and the buyer-typed COD PROVINCE, both of
//      which are now read from the seller's/courier's own data. A claim from the client is not a
//      fact. So `weight` is not merely distrusted here: the field DOES NOT EXIST in the request
//      body any more — a field that exists will eventually be trusted by someone.
//
// The client says WHAT is in the cart (variant + qty — which is checkable: the order API resolves
// exactly the same way and rejects unknown/out-of-stock lines); the SERVER says what it weighs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback for a variant whose `weight_grams` is NULL (seller left "Berat" blank / legacy import).
 * DOCUMENTED, not silent: `weightForCart()` returns `missing[]`, and the Seller's Produk list +
 * product editor show "Berat belum diisi — ongkir bisa salah" so the merchant can fix the cause.
 */
export const DEFAULT_WEIGHT_GRAMS = 500;

/** Couriers bill a 1 kg minimum — a 675 g parcel is priced as 1 kg. Applied to the SUM, once. */
export const MIN_BILLABLE_GRAMS = 1000;

/** What the checkout sends: the cart. No weight, no price — those are ours to determine. */
export type CartItemRef = {
  /** Preferred: the real `product_variants.id` (storefront carts don't carry it yet). */
  variantId?: string | null;
  /** How the storefront cart identifies a line today: product handle + variant title. */
  handle?: string | null;
  variant?: string | null;
  qty?: number | null;
};

export type CartWeight = {
  /** Σ(variant.weight_grams × qty) — the actual weight of the parcel, in grams. */
  grams: number;
  /** What we quote against: `max(grams, MIN_BILLABLE_GRAMS)`. */
  billableGrams: number;
  /** Lines whose variant had no weight and fell back to DEFAULT_WEIGHT_GRAMS (for the response). */
  missing: string[];
  /** Cart lines that resolved to a real variant of this store. */
  resolved: number;
};

/** Sum a cart's weight from the DB. Resolution mirrors /api/public/order (handle + variant title). */
export async function weightForCart(db: Tx, storeId: string, items: CartItemRef[]): Promise<CartWeight> {
  const clean = items.filter((i) => (i.qty ?? 0) > 0);
  const variantIds = clean.map((i) => i.variantId).filter((v): v is string => typeof v === "string" && v.length > 0);
  const handles = clean.map((i) => i.handle).filter((h): h is string => typeof h === "string" && h.length > 0);

  const where: SQL[] = [];
  if (variantIds.length) where.push(inArray(schema.productVariants.id, [...new Set(variantIds)])!);
  if (handles.length) where.push(inArray(schema.products.handle, [...new Set(handles)])!);
  if (!where.length) return { grams: 0, billableGrams: MIN_BILLABLE_GRAMS, missing: [], resolved: 0 };

  // Scoped to THIS store: a variant id (or handle) belonging to someone else's store must not be a
  // way to price a parcel against a lighter catalog.
  const rows = await db
    .select({
      id: schema.productVariants.id,
      handle: schema.products.handle,
      title: schema.productVariants.title,
      position: schema.productVariants.position,
      weight: schema.productVariants.weightGrams,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(and(eq(schema.products.storeId, storeId), where.length === 1 ? where[0] : or(...where)));

  let grams = 0;
  let resolved = 0;
  const missing: string[] = [];
  for (const i of clean) {
    const qty = i.qty ?? 1;
    const byId = i.variantId ? rows.find((r) => r.id === i.variantId) : undefined;
    const forHandle = i.handle ? rows.filter((r) => r.handle === i.handle) : [];
    const match =
      byId ??
      (i.variant ? forHandle.find((r) => r.title === i.variant) : undefined) ??
      // same fallback the order API uses: the default (position-0) variant
      forHandle.slice().sort((a, b) => a.position - b.position)[0];

    if (!match) {
      // Unknown line: it cannot ship, so it cannot be free either — charge the documented default.
      missing.push(i.handle || i.variantId || "?");
      grams += DEFAULT_WEIGHT_GRAMS * qty;
      continue;
    }
    resolved++;
    if (match.weight == null) {
      missing.push(match.handle + (match.title ? ` (${match.title})` : ""));
      grams += DEFAULT_WEIGHT_GRAMS * qty;
    } else {
      grams += match.weight * qty;
    }
  }
  return { grams, billableGrams: Math.max(MIN_BILLABLE_GRAMS, grams), missing, resolved };
}

/** Same thing for an EXISTING order — from its line items' variants (the admin re-quote + booking). */
export async function weightForOrder(db: Tx, orderId: string): Promise<CartWeight> {
  const rows = await db
    .select({
      weight: schema.productVariants.weightGrams,
      qty: schema.orderLineItems.qty,
      title: schema.orderLineItems.title,
      variantId: schema.orderLineItems.variantId,
    })
    .from(schema.orderLineItems)
    .leftJoin(schema.productVariants, eq(schema.productVariants.id, schema.orderLineItems.variantId))
    .where(eq(schema.orderLineItems.orderId, orderId));

  let grams = 0;
  let resolved = 0;
  const missing: string[] = [];
  for (const r of rows) {
    const qty = r.qty ?? 1;
    if (r.variantId) resolved++;
    if (r.weight == null) {
      missing.push(r.title);
      grams += DEFAULT_WEIGHT_GRAMS * qty;
    } else {
      grams += r.weight * qty;
    }
  }
  return { grams, billableGrams: Math.max(MIN_BILLABLE_GRAMS, grams), missing, resolved };
}
