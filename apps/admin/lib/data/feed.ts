import "server-only";
import { schema } from "@tokophi/db";
import { ne, sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";
import { getStoreSlug } from "@/lib/data/store";
import { systemDomainFor } from "@/lib/data/domain";
import { getSession } from "@/lib/auth";

// Feed health for the Pemasaran "Katalog Iklan" card (ADR 0011). Surfaces the always-on feed URL the
// merchant pastes into Google Merchant / Meta Commerce, plus how ready the catalogue is (a product with
// no Google category is dropped from the feed by those platforms, so "classified" is the number that
// matters).
export type FeedStatus = {
  feedUrl: string; // "" when the store has no slug yet (should not happen post-provision)
  total: number;
  classified: number; // has google_category_id — the ones a feed platform will accept
  withGender: number;
};

export async function getFeedStatus(): Promise<FeedStatus> {
  const session = await getSession();
  const slug = session ? await getStoreSlug(session.storeId) : null;
  const feedUrl = slug ? `https://${systemDomainFor(slug)}/feed/google.xml` : "";
  return withCurrentTenant(async (db) => {
    const [r] = await db
      .select({
        total: sql<number>`count(*)::int`,
        classified: sql<number>`count(${schema.products.googleCategoryId})::int`,
        withGender: sql<number>`count(${schema.products.gender})::int`,
      })
      .from(schema.products)
      .where(ne(schema.products.status, "archived"));
    return { feedUrl, total: r?.total ?? 0, classified: r?.classified ?? 0, withGender: r?.withGender ?? 0 };
  });
}
