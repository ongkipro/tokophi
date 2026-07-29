import "server-only";
import { schema } from "@tokophi/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";
import { getStoreSlug } from "@/lib/data/store";
import { systemDomainFor } from "@/lib/data/domain";
import { getSession } from "@/lib/auth";

// Feed health for the Pemasaran "Katalog Iklan" card (ADR 0011 + ADR 0013). Surfaces the always-on feed
// URLs the merchant pastes into Google Merchant / Meta Commerce / TikTok, plus how ready the catalogue
// is.
//
// ⚠️ `total` counts what the FEED actually publishes: `status = 'active'` AND a primary image. It used
// to be `!= 'archived'`, which quietly included drafts the feed never emits — so the card claimed a
// bigger catalog than the merchant could possibly see in Merchant Center, and there was no way to tell
// from the screen why. `image` is in the same condition because all three providers REQUIRE
// `image_link`, so a photo-less product cannot form a valid item at all.
//
// ⚠️ Also corrected: `classified` is a QUALITY signal, not an admission ticket. An earlier comment here
// claimed "a product with no Google category is dropped from the feed by those platforms" — that is
// false. `google_product_category` is optional for all three; a missing one degrades matching, it does
// not remove the item.
export type FeedStatus = {
  feedUrl: string; // "" when the store has no slug yet (should not happen post-provision)
  tiktokFeedUrl: string;
  total: number;
  classified: number; // has google_category_id — better matching, not a requirement
  withGender: number;
  /** ADR 0013 — which id this store publishes: the stable `number` scheme, or the legacy `handle`. */
  catalogIdScheme: string;
};

export async function getFeedStatus(): Promise<FeedStatus> {
  const session = await getSession();
  const slug = session ? await getStoreSlug(session.storeId) : null;
  const feedUrl = slug ? `https://${systemDomainFor(slug)}/feed/google.xml` : "";
  const tiktokFeedUrl = slug ? `https://${systemDomainFor(slug)}/feed/tiktok.xml` : "";
  return withCurrentTenant(async (db, storeId) => {
    const [st] = await db
      .select({ scheme: schema.stores.catalogIdScheme })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .limit(1);
    const [r] = await db
      .select({
        total: sql<number>`count(*)::int`,
        classified: sql<number>`count(${schema.products.googleCategoryId})::int`,
        withGender: sql<number>`count(${schema.products.gender})::int`,
      })
      .from(schema.products)
      // The primary image is what makes a product publishable; join it rather than assume it exists.
      .leftJoin(
        schema.productMedia,
        and(eq(schema.productMedia.productId, schema.products.id), eq(schema.productMedia.position, 0)),
      )
      .where(and(eq(schema.products.status, "active"), isNotNull(schema.productMedia.url)));
    return {
      feedUrl,
      tiktokFeedUrl,
      total: r?.total ?? 0,
      classified: r?.classified ?? 0,
      withGender: r?.withGender ?? 0,
      catalogIdScheme: st?.scheme ?? "handle",
    };
  });
}
