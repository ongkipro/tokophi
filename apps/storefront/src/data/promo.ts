import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";

// The /promo/<handle> landing config for one product. Storefront reads as OWNER (tenant already
// resolved from the Host header), so the store scope is an explicit WHERE on products.store_id —
// promo_pages carries no independent identity, it is reached THROUGH its product.
export type PromoContent = {
  problemTitle?: string;
  problemBullets?: string[];
  agitation?: string;
  solutionTitle?: string;
  solutionBody?: string;
  guarantee?: string;
};

export type StorePromo = {
  enabled: boolean;
  headline: string | null;
  subheadline: string | null;
  badge: string | null;
  benefits: string[];
  idealFor: string[];
  content: PromoContent;
  countdownMinutes: number;
  showScarcity: boolean;
  formConfig: unknown; // resolved by the OrderFunnel via @tokophi/lib/form-config
};

export async function getPromoConfig(storeId: string, handle: string): Promise<StorePromo | null> {
  const [row] = await db
    .select({
      enabled: schema.promoPages.enabled,
      headline: schema.promoPages.headline,
      subheadline: schema.promoPages.subheadline,
      badge: schema.promoPages.badge,
      benefits: schema.promoPages.benefits,
      idealFor: schema.promoPages.idealFor,
      content: schema.promoPages.content,
      countdownMinutes: schema.promoPages.countdownMinutes,
      showScarcity: schema.promoPages.showScarcity,
      formConfig: schema.promoPages.formConfig,
    })
    .from(schema.promoPages)
    .innerJoin(schema.products, eq(schema.products.id, schema.promoPages.productId))
    .where(and(eq(schema.products.storeId, storeId), eq(schema.products.handle, handle)))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    benefits: Array.isArray(row.benefits) ? (row.benefits as string[]) : [],
    idealFor: Array.isArray(row.idealFor) ? (row.idealFor as string[]) : [],
    content: (row.content && typeof row.content === "object" ? row.content : {}) as PromoContent,
  };
}
