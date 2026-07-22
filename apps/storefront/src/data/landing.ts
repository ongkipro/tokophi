import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";

// Custom-HTML landing (/lp/<slug>). Storefront reads as OWNER (tenant resolved from Host), so the store
// scope is an explicit WHERE on landing_pages.store_id. The product HANDLE (for the checkout) comes from
// the joined products row — the OrderFunnel orders by handle.
export type StoreLanding = {
  title: string;
  html: string;
  productHandle: string;
  countdownMinutes: number;
  showScarcity: boolean;
};

export async function getLandingPage(storeId: string, slug: string): Promise<StoreLanding | null> {
  const [row] = await db
    .select({
      title: schema.landingPages.title,
      html: schema.landingPages.html,
      productHandle: schema.products.handle,
      countdownMinutes: schema.landingPages.countdownMinutes,
      showScarcity: schema.landingPages.showScarcity,
    })
    .from(schema.landingPages)
    .innerJoin(schema.products, eq(schema.products.id, schema.landingPages.productId))
    .where(
      and(
        eq(schema.landingPages.storeId, storeId),
        eq(schema.landingPages.slug, slug),
        eq(schema.landingPages.enabled, true),
      ),
    )
    .limit(1);
  return row ?? null;
}
