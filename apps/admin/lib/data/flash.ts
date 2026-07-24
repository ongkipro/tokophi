import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { and, asc, desc, eq } from "drizzle-orm";

export type FlashStatus = "aktif" | "terjadwal" | "nonaktif";

export type FlashSaleRow = {
  id: string;
  name: string;
  status: FlashStatus;
  startsAt: string; // ISO
  endsAt: string; // ISO
  itemCount: number;
  /** status='aktif' AND now inside the window — the ONLY state that actually drops prices. */
  isLive: boolean;
};

export type FlashProductPick = { productId: string; title: string; basePrice: number; salePriceIdr: number };

export type FlashSaleEditor = {
  id: string;
  name: string;
  status: FlashStatus;
  startsAt: string; // ISO
  endsAt: string; // ISO
  items: { productId: string; salePriceIdr: number }[];
};

/** Every active product in the store + its base price, so the editor can offer them to put on sale. */
export async function getStoreProductsForFlash(): Promise<{ id: string; title: string; basePrice: number }[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({ id: schema.products.id, title: schema.products.title, basePrice: schema.productVariants.priceIdr })
      .from(schema.products)
      .innerJoin(
        schema.productVariants,
        and(eq(schema.productVariants.productId, schema.products.id), eq(schema.productVariants.position, 0)),
      )
      .where(eq(schema.products.status, "active"))
      .orderBy(asc(schema.products.title));
    return rows.map((r) => ({ id: r.id, title: r.title, basePrice: r.basePrice }));
  });
}

export async function getFlashSales(): Promise<FlashSaleRow[]> {
  return withCurrentTenant(async (db) => {
    const sales = await db.select().from(schema.flashSales).orderBy(desc(schema.flashSales.startsAt));
    const now = Date.now();
    // One extra query for counts, then joined in memory — a store has few sales, so N is tiny.
    const items = await db
      .select({ flashSaleId: schema.flashSaleItems.flashSaleId })
      .from(schema.flashSaleItems)
      .innerJoin(schema.flashSales, eq(schema.flashSales.id, schema.flashSaleItems.flashSaleId));
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.flashSaleId, (counts.get(it.flashSaleId) ?? 0) + 1);
    return sales.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status as FlashStatus,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      itemCount: counts.get(s.id) ?? 0,
      isLive: s.status === "aktif" && s.startsAt.getTime() <= now && now < s.endsAt.getTime(),
    }));
  });
}

export async function getFlashSale(id: string): Promise<FlashSaleEditor | null> {
  return withCurrentTenant(async (db) => {
    const [s] = await db.select().from(schema.flashSales).where(eq(schema.flashSales.id, id)).limit(1);
    if (!s) return null;
    const items = await db
      .select({ productId: schema.flashSaleItems.productId, salePriceIdr: schema.flashSaleItems.salePriceIdr })
      .from(schema.flashSaleItems)
      .where(eq(schema.flashSaleItems.flashSaleId, id));
    return {
      id: s.id,
      name: s.name,
      status: s.status as FlashStatus,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      items: items.map((i) => ({ productId: i.productId, salePriceIdr: i.salePriceIdr })),
    };
  });
}
