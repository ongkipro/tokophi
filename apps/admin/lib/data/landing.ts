import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { BASE_DOMAIN } from "@/lib/data/domain";
import { resolveFormConfig, type FormConfig } from "@tokophi/lib/form-config";
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
  formConfig: FormConfig;
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

/**
 * A blank draft for `/promo/html/baru`. Nothing is written until Simpan — `saveLanding` INSERTs when
 * it gets no id, so an abandoned draft leaves no row (and no slug squatting `/lp/<slug>`).
 *
 * It is its own function rather than `getLandingEditor("baru")` because the editor route is
 * `[id]`-keyed and 404s anything that is not a UUID (`lib/uuid.ts` — Postgres throws `22P02`, a 500
 * where a 404 belongs). A magic string threaded through an id parameter would be describing a route
 * shape that cannot exist. Never returns null: there is always a draft to render.
 */
export async function newLandingEditor(): Promise<LandingEditor> {
  return withCurrentTenant(async (db: Tx) => {
    const products = await activeProducts(db);
    return {
      id: null, slug: "", title: "", html: "", productId: products[0]?.id ?? "",
      enabled: false, countdownMinutes: 0, showScarcity: true, formConfig: resolveFormConfig({}), products, shareUrl: null,
    };
  });
}

/** Editor state for an existing landing. `null` = no such row in THIS store (RLS scopes the read). */
export async function getLandingEditor(id: string): Promise<LandingEditor | null> {
  return withCurrentTenant(async (db: Tx, storeId: string) => {
    const products = await activeProducts(db);
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
      formConfig: resolveFormConfig(row.formConfig),
      products,
      shareUrl: shareUrl(slug, row.slug),
    };
  });
}
