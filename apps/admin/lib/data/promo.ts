import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { BASE_DOMAIN } from "@/lib/data/domain";
import { and, asc, eq } from "drizzle-orm";

// The shareable landing URL a merchant copies into an ad — the store's system storefront domain
// (`<slug>.<base>`) + the promo path. `stores` has no store_id, so it MUST be read WHERE id = storeId
// (the documented cross-tenant blind spot), never `.from(stores).limit(1)`.
async function storeSlug(db: Tx, storeId: string): Promise<string> {
  const [s] = await db.select({ slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  return s?.slug ?? "";
}
const shareUrl = (slug: string, handle: string) => (slug ? `https://${slug}.${BASE_DOMAIN}/promo/${handle}` : `/promo/${handle}`);

// The /promo/<handle> LANDING config, read for the Seller "Halaman Promo" editor. One product = one
// optional promo page. All reads are tenant-scoped (withCurrentTenant → tokophi_app under RLS).

// Long-form sales sections (AI-generated, all optional). A landing renders on the hero fields alone.
export type PromoContent = {
  problemTitle?: string;
  problemBullets?: string[];
  agitation?: string;
  solutionTitle?: string;
  solutionBody?: string;
  guarantee?: string;
};

export type PromoConfig = {
  enabled: boolean;
  headline: string;
  subheadline: string;
  badge: string;
  benefits: string[];
  idealFor: string[];
  content: PromoContent;
  countdownMinutes: number;
  showScarcity: boolean;
};

export type PromoListRow = {
  productId: string;
  name: string;
  handle: string;
  image: string | null;
  enabled: boolean;
  shareUrl: string;
};

export type PromoEditor = {
  productId: string;
  name: string;
  handle: string;
  shareUrl: string;
  // the product's own values, shown as the placeholder/fallback the overrides fall back to
  productDescription: string;
  productBadge: string;
  config: PromoConfig;
};

const EMPTY: PromoConfig = {
  enabled: false, headline: "", subheadline: "", badge: "",
  benefits: [], idealFor: [], content: {}, countdownMinutes: 20, showScarcity: true,
};

function toConfig(row: typeof schema.promoPages.$inferSelect | undefined): PromoConfig {
  if (!row) return { ...EMPTY };
  return {
    enabled: row.enabled,
    headline: row.headline ?? "",
    subheadline: row.subheadline ?? "",
    badge: row.badge ?? "",
    benefits: Array.isArray(row.benefits) ? (row.benefits as string[]) : [],
    idealFor: Array.isArray(row.idealFor) ? (row.idealFor as string[]) : [],
    content: (row.content && typeof row.content === "object" ? row.content : {}) as PromoContent,
    countdownMinutes: row.countdownMinutes,
    showScarcity: row.showScarcity,
  };
}

/** Every active product with its promo on/off flag — the list screen. */
export async function listPromoPages(): Promise<PromoListRow[]> {
  return withCurrentTenant(async (db: Tx, storeId: string) => {
    const slug = await storeSlug(db, storeId);
    const rows = await db
      .select({
        productId: schema.products.id,
        name: schema.products.title,
        handle: schema.products.handle,
        image: schema.productMedia.url,
        enabled: schema.promoPages.enabled,
      })
      .from(schema.products)
      .leftJoin(schema.promoPages, eq(schema.promoPages.productId, schema.products.id))
      .leftJoin(
        schema.productMedia,
        and(eq(schema.productMedia.productId, schema.products.id), eq(schema.productMedia.position, 0)),
      )
      .where(eq(schema.products.status, "active"))
      .orderBy(asc(schema.products.title));
    return rows.map((r) => ({ ...r, enabled: r.enabled ?? false, shareUrl: shareUrl(slug, r.handle) }));
  });
}

/** One product's editor state (config + the product fallbacks). `null` = product not in this store. */
export async function getPromoEditor(productId: string): Promise<PromoEditor | null> {
  return withCurrentTenant(async (db: Tx, storeId: string) => {
    const [prod] = await db
      .select({
        id: schema.products.id,
        name: schema.products.title,
        handle: schema.products.handle,
        description: schema.products.description,
        badge: schema.products.badge,
      })
      .from(schema.products)
      .where(and(eq(schema.products.id, productId), eq(schema.products.status, "active")))
      .limit(1);
    if (!prod) return null; // RLS already scopes to this store; the status check is the only extra
    const [promo] = await db.select().from(schema.promoPages).where(eq(schema.promoPages.productId, productId)).limit(1);
    const slug = await storeSlug(db, storeId);
    return {
      productId: prod.id,
      name: prod.name,
      handle: prod.handle,
      shareUrl: shareUrl(slug, prod.handle),
      productDescription: prod.description ?? "",
      productBadge: prod.badge ?? "",
      config: toConfig(promo),
    };
  });
}
