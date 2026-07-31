"use server";
import { schema } from "@tokophi/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import type { Tx } from "@/lib/tenant";

// Flash sale is discount-family, so it rides the SAME capability as vouchers.
const CAP = "discounts:write" as const;

export type FlashInput = {
  name: string;
  status: "aktif" | "terjadwal" | "nonaktif";
  startsAt: string; // ISO from the editor's datetime-local
  endsAt: string; // ISO
  items: { productId: string; salePriceIdr: number }[];
};

/**
 * A rule the MERCHANT broke, as opposed to something that went wrong.
 *
 * Next MASKS a thrown Error in production — the client receives an opaque digest, so
 * "Tanggal berakhir harus setelah tanggal mulai" reached the merchant as
 * "An error occurred in the Server Components render". Every message in this file is one the
 * merchant can act on, which makes throwing exactly the wrong shape for all of them.
 * `theme.ts` was converted to `{ ok, error }` for this reason; this file was left behind.
 */
class FlashRuleError extends Error {}

/** Run a write and turn a broken RULE into a message, while letting real failures keep throwing —
 *  a DB outage is not something to render as friendly advice next to the Simpan button. */
async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof FlashRuleError) return { ok: false, error: e.message };
    throw e;
  }
}

function saleFields(i: FlashInput) {
  const startsAt = new Date(i.startsAt);
  const endsAt = new Date(i.endsAt);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) throw new FlashRuleError("Tanggal mulai/berakhir tidak valid.");
  if (endsAt <= startsAt) throw new FlashRuleError("Tanggal berakhir harus setelah tanggal mulai.");
  const name = i.name.trim();
  if (!name) throw new FlashRuleError("Nama flash sale wajib diisi.");
  return { name, status: i.status, startsAt, endsAt };
}

// Replace the sale's product rows. CHILD-TABLE RULE: `flash_sale_items` has no store_id and no RLS, so
// every id it is keyed on must be proven to belong to THIS tenant inside the same txn before we write:
//   · the parent `saleId` — the caller verified it (fresh insert, or a read-back) and passes ownsSale
//   · each `productId`     — filtered here against the tenant's own `products` (RLS'd) — a foreign or
//                            unknown product id is dropped, never inserted against another store's row.
async function writeItems(db: Tx, saleId: string, ownsSale: boolean, items: FlashInput["items"]): Promise<void> {
  if (!ownsSale) return; // parent not the tenant's → touch nothing (the parent update already no-op'd)
  await db.delete(schema.flashSaleItems).where(eq(schema.flashSaleItems.flashSaleId, saleId));
  const wanted = items.filter((it) => it.productId && Number(it.salePriceIdr) > 0);
  if (!wanted.length) return;
  const ids = [...new Set(wanted.map((it) => it.productId))];
  const owned = await db
    .select({ id: schema.products.id, title: schema.products.title })
    .from(schema.products)
    .where(inArray(schema.products.id, ids)); // RLS scopes this to the tenant
  const ownedIds = new Map(owned.map((r) => [r.id, r.title]));

  // ⚠️ A SALE PRICE AT OR ABOVE THE PRODUCT'S PRICE IS REFUSED.
  //
  // Both pricing readers apply `min(variantPrice, salePrice)`, so a sale priced above the goods
  // discounts NOTHING — while the seller's list badges it "Berlangsung" and the storefront shows no
  // cut. The merchant runs a campaign that is not running. Only `> 0` was checked, and the editor
  // renders a "≥ harga normal" warning that its own `validate()` never enforced.
  //
  // Compared against the product's MAX variant price, not the position-0 one: `min` is applied per
  // variant, so the sale is inert unless it undercuts the dearest variant it is meant to discount.
  const maxPrices = await db
    .select({ productId: schema.productVariants.productId, maxPrice: sql<number>`max(${schema.productVariants.priceIdr})`.mapWith(Number) })
    .from(schema.productVariants)
    .where(inArray(schema.productVariants.productId, [...ownedIds.keys()]))
    .groupBy(schema.productVariants.productId);
  const ceiling = new Map(maxPrices.map((r) => [r.productId, r.maxPrice]));
  for (const it of wanted) {
    if (!ownedIds.has(it.productId)) continue;
    const cap = ceiling.get(it.productId);
    if (cap != null && Math.round(Number(it.salePriceIdr)) >= cap) {
      throw new FlashRuleError(
        `Harga flash untuk "${ownedIds.get(it.productId)}" (${Math.round(Number(it.salePriceIdr))}) tidak boleh sama atau lebih tinggi dari harga produk (${cap}) — promo tidak akan memotong apa pun.`,
      );
    }
  }

  const rows = wanted
    .filter((it) => ownedIds.has(it.productId))
    .map((it) => ({ flashSaleId: saleId, productId: it.productId, salePriceIdr: Math.round(Number(it.salePriceIdr)) }));
  if (rows.length) await db.insert(schema.flashSaleItems).values(rows);
}

export type FlashResult = { ok: true; id: string } | { ok: false; error: string };

export async function createFlashSale(input: FlashInput): Promise<FlashResult> {
  const { storeId } = await requireCapability(CAP);
  const r = await guard(() =>
    withTenant(storeId, async (db) => {
      const [s] = await db.insert(schema.flashSales).values({ storeId, ...saleFields(input) }).returning();
      await writeItems(db, s.id, true, input.items); // fresh insert under this tenant → owned by construction
      return s.id;
    }),
  );
  if (!r.ok) return r;
  revalidatePath("/flash-sale");
  return { ok: true, id: r.value };
}

export async function updateFlashSale(id: string, input: FlashInput): Promise<FlashResult> {
  const { storeId } = await requireCapability(CAP);
  const r = await guard(() =>
    withTenant(storeId, async (db) => {
      // Prove the sale is the tenant's BEFORE writing items keyed on it (flash_sales is RLS'd).
      const [owned] = await db.select({ id: schema.flashSales.id }).from(schema.flashSales).where(eq(schema.flashSales.id, id)).limit(1);
      await db.update(schema.flashSales).set(saleFields(input)).where(eq(schema.flashSales.id, id));
      await writeItems(db, id, !!owned, input.items);
      return id;
    }),
  );
  if (!r.ok) return r;
  revalidatePath("/flash-sale");
  revalidatePath(`/flash-sale/${id}`);
  return { ok: true, id };
}

export async function deleteFlashSale(id: string): Promise<void> {
  const { storeId } = await requireCapability(CAP);
  await withTenant(storeId, async (db) => {
    // The FK `flash_sale_items.flash_sale_id` is ON DELETE CASCADE, so deleting the (RLS'd) parent takes
    // its items with it — no separate child delete to scope. A foreign id simply deletes nothing.
    await db.delete(schema.flashSales).where(eq(schema.flashSales.id, id));
  });
  revalidatePath("/flash-sale");
}
