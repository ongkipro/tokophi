import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { BASE_DOMAIN } from "@/lib/data/domain";
import { and, asc, eq } from "drizzle-orm";

// Custom-HTML landings (/lp/<slug>) for the Seller editor. Tenant-scoped reads (withCurrentTenant).

export type LandingListRow = {
  id: string;
  slug: string;
  title: string;
  enabled: boolean;
  productName: string;
  shareUrl: string;
};

export type LandingEditor = {
  id: string | null; // null = creating a new one
  slug: string;
  title: string;
  html: string;
  productId: string;
  enabled: boolean;
  countdownMinutes: number;
  showScarcity: boolean;
  products: { id: string; name: string }[]; // picker options
  shareUrl: string | null;
};

async function storeSlug(db: Tx, storeId: string): Promise<string> {
  const [s] = await db.select({ slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  return s?.slug ?? "";
}
const shareUrl = (store: string, lp: string) => (store && lp ? `https://${store}.${BASE_DOMAIN}/lp/${lp}` : `/lp/${lp}`);

async function activeProducts(db: Tx): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.products.id, name: schema.products.title })
    .from(schema.products)
    .where(eq(schema.products.status, "active"))
    .orderBy(asc(schema.products.title));
}

export async function listLandings(): Promise<LandingListRow[]> {
  return withCurrentTenant(async (db: Tx, storeId: string) => {
    const slug = await storeSlug(db, storeId);
    const rows = await db
      .select({
        id: schema.landingPages.id,
        slug: schema.landingPages.slug,
        title: schema.landingPages.title,
        enabled: schema.landingPages.enabled,
        productName: schema.products.title,
      })
      .from(schema.landingPages)
      .innerJoin(schema.products, eq(schema.products.id, schema.landingPages.productId))
      .orderBy(asc(schema.landingPages.title));
    return rows.map((r) => ({ ...r, shareUrl: shareUrl(slug, r.slug) }));
  });
}

/** Editor state. `id === "baru"` → a blank create form (still needs the product picker). */
export async function getLandingEditor(id: string): Promise<LandingEditor | null> {
  return withCurrentTenant(async (db: Tx, storeId: string) => {
    const products = await activeProducts(db);
    if (id === "baru") {
      return {
        id: null, slug: "", title: "", html: "", productId: products[0]?.id ?? "",
        enabled: false, countdownMinutes: 0, showScarcity: true, products, shareUrl: null,
      };
    }
    const [row] = await db.select().from(schema.landingPages).where(eq(schema.landingPages.id, id)).limit(1);
    if (!row) return null; // RLS already scopes to this store
    const slug = await storeSlug(db, storeId);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      html: row.html,
      productId: row.productId,
      enabled: row.enabled,
      countdownMinutes: row.countdownMinutes,
      showScarcity: row.showScarcity,
      products,
      shareUrl: shareUrl(slug, row.slug),
    };
  });
}
