"use server";
import { schema } from "@tokophi/db";
import { and, eq, inArray } from "drizzle-orm";
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

function saleFields(i: FlashInput) {
  const startsAt = new Date(i.startsAt);
  const endsAt = new Date(i.endsAt);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) throw new Error("Tanggal mulai/berakhir tidak valid.");
  if (endsAt <= startsAt) throw new Error("Tanggal berakhir harus setelah tanggal mulai.");
  const name = i.name.trim();
  if (!name) throw new Error("Nama flash sale wajib diisi.");
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
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(inArray(schema.products.id, ids)); // RLS scopes this to the tenant
  const ownedIds = new Set(owned.map((r) => r.id));
  const rows = wanted
    .filter((it) => ownedIds.has(it.productId))
    .map((it) => ({ flashSaleId: saleId, productId: it.productId, salePriceIdr: Math.round(Number(it.salePriceIdr)) }));
  if (rows.length) await db.insert(schema.flashSaleItems).values(rows);
}

export async function createFlashSale(input: FlashInput): Promise<string> {
  const { storeId } = await requireCapability(CAP);
  const id = await withTenant(storeId, async (db) => {
    const [s] = await db.insert(schema.flashSales).values({ storeId, ...saleFields(input) }).returning();
    await writeItems(db, s.id, true, input.items); // fresh insert under this tenant → owned by construction
    return s.id;
  });
  revalidatePath("/flash-sale");
  return id;
}

export async function updateFlashSale(id: string, input: FlashInput): Promise<void> {
  const { storeId } = await requireCapability(CAP);
  await withTenant(storeId, async (db) => {
    // Prove the sale is the tenant's BEFORE writing items keyed on it (flash_sales is RLS'd).
    const [owned] = await db.select({ id: schema.flashSales.id }).from(schema.flashSales).where(eq(schema.flashSales.id, id)).limit(1);
    await db.update(schema.flashSales).set(saleFields(input)).where(eq(schema.flashSales.id, id));
    await writeItems(db, id, !!owned, input.items);
  });
  revalidatePath("/flash-sale");
  revalidatePath(`/flash-sale/${id}`);
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
