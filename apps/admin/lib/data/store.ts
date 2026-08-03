import "server-only";
import { schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/tenant";
import { systemDomainFor } from "@/lib/data/domain";

// The current store's own name (by validated session storeId) — so the admin chrome reflects
// the store you're actually in (incl. an impersonated store from the super-admin), not a hardcode.
export async function getStoreName(storeId: string): Promise<string | null> {
  return withTenant(storeId, async (db: Tx) => {
    const [s] = await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    return s?.name ?? null;
  });
}

// the store's URL slug — for Shopify-style /store/{slug}/… links + deep-links.
export async function getStoreSlug(storeId: string): Promise<string | null> {
  return withTenant(storeId, async (db: Tx) => {
    const [s] = await db.select({ slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    return s?.slug ?? null;
  });
}

/**
 * The store's CANONICAL storefront host — the one a link we send a shopper must use.
 *
 * ⚠️ THIS MUST AGREE WITH THE STOREFRONT'S `primaryOrigin()` (`apps/storefront/src/data/store.ts`).
 * Same rule, stated twice because the two surfaces cannot import each other: an **active**, primary
 * custom domain wins; otherwise the system subdomain `<slug>.<STOREFRONT_BASE_DOMAIN>`.
 *
 * `status = 'active'` is load-bearing — a domain still `pending`/`provisioning` does not answer yet,
 * and its cert is not issued. Pointing a recovery link at one sends the shopper to a TLS warning or a
 * dead host. (The storefront's own comment makes the same point about 301-ing shoppers there.)
 *
 * Returns null only when the store has no slug at all, which should not happen.
 */
export async function getStorefrontHost(storeId: string): Promise<string | null> {
  return withTenant(storeId, async (db: Tx) => {
    const [s] = await db.select({ slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!s?.slug) return null;
    const [dom] = await db
      .select({ host: schema.storeDomains.host })
      .from(schema.storeDomains)
      .where(
        and(
          eq(schema.storeDomains.storeId, storeId),
          eq(schema.storeDomains.isPrimary, true),
          eq(schema.storeDomains.status, "active"),
        ),
      )
      .limit(1);
    return dom?.host ?? systemDomainFor(s.slug);
  });
}
