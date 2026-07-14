// Host → store resolution (ADR 0009 / PROD_PLAN §5): ONE storefront deploy serves EVERY store,
// the tenant is resolved from the request's `Host` header at request time — no per-client build,
// no STORE_SLUG-per-deploy, no DB access at `astro build` time.
//
// Resolution order (first hit wins):
//   1. custom domain          — `toko-pelanggan.com`      → SEAM, not wired yet (no column; see below)
//   2. store subdomain        — `<slug>.<STOREFRONT_BASE_DOMAIN>`  e.g. batik-nusantara.toko.tokophi.com
//   3. first label of the host — `<slug>.anything.else`    e.g. batik-nusantara.127.0.0.1.sslip.io
//   4. fallback env           — STORE_SLUG / DEFAULT_STORE_SLUG   (local dev + today's single-tenant box)
// Nothing matches → null → middleware renders a clean 404 ("Toko tidak ditemukan"), never a crash.
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { cached } from "./cache";

export type StoreInfo = {
  id: string;
  name: string;
  slug: string;
  /** `null` = the merchant has not written one. Render NOTHING — never a platform default. */
  tagline: string | null;
  /** `null` = no CS WhatsApp set. Render NO WhatsApp button at all. */
  whatsapp: string | null;
  city: string;
  logoUrl: string | null;
  brandColor: string | null;
};

// REMOVED: `DEFAULT_TAGLINE` / `DEFAULT_WHATSAPP`.
//
// `stores` had no whatsapp/tagline column, so these platform constants were rendered for EVERY tenant
// — and `6281234567890` (the canonical Indonesian dummy number) shipped as a live "Hubungi via
// WhatsApp" button on every page of every store, ~19 times per page. Every one of them opened a chat
// with nobody. A merchant whose CS number is dead loses the sale AND the trust, and never finds out.
//
// The columns exist now (migration 0049) and they are NULLABLE on purpose: a store that has not set
// one renders NOTHING. A missing channel is honest; a dead one is a lie.

// Subdomains that are never a store slug (platform surfaces / conventional hostnames).
const RESERVED = new Set(["www", "app", "rich", "admin", "api", "cname", "toko", "storefront", "localhost"]);

/** lowercase, port-stripped, trailing-dot-stripped hostname. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

// Runtime env (process.env, NOT import.meta.env): the Docker image is built WITHOUT env, so
// anything read at build time would be baked in as undefined.
const env = (k: string) => (process.env[k] ?? "").trim();

/**
 * `<slug>.<base>` → slug. Configured base domain (prod), e.g. STOREFRONT_BASE_DOMAIN=tokophi.com
 * → `batik-nusantara.tokophi.com`. The base is the APEX, so the platform's own surfaces
 * (`app.`/`rich.`/`www.`…) are one label deep too — RESERVED keeps them from resolving as a store.
 */
function slugFromBaseDomain(host: string): string | null {
  const base = normalizeHost(env("STOREFRONT_BASE_DOMAIN"));
  if (!base || !host.endsWith("." + base)) return null;
  const prefix = host.slice(0, -(base.length + 1));
  if (!prefix || prefix.includes(".") || RESERVED.has(prefix)) return null;
  return prefix;
}

/**
 * First label of any multi-label host — covers the sslip.io box (`<slug>.203.0.113.10.sslip.io`)
 * without configuring a base domain. Numeric first labels are skipped so a bare IP / bare
 * `1.2.3.4.sslip.io` host isn't read as a store slug.
 */
function slugFromFirstLabel(host: string): string | null {
  const labels = host.split(".");
  if (labels.length < 2) return null;
  const first = labels[0];
  if (!first || RESERVED.has(first) || /^\d+$/.test(first)) return null;
  return first;
}

/**
 * SEAM — custom merchant domains (`toko-pelanggan.com` → store). Deliberately NOT implemented:
 * `stores.custom_domain` / a `store_domains` table does not exist yet (PROD_PLAN §5 calls for it,
 * it's its own track — no migration in this pass). When it lands, the ONLY change needed is to
 * make this query it (and add the host to the cache key, which it already is).
 */
async function slugFromCustomDomain(_host: string): Promise<string | null> {
  return null;
}

const toStoreInfo = (r: typeof schema.stores.$inferSelect): StoreInfo => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  tagline: r.tagline,
  whatsapp: r.whatsapp,
  city: r.city ?? "",
  logoUrl: r.logoUrl,
  brandColor: r.brandColor,
});

export async function getStoreBySlug(slug: string): Promise<StoreInfo | null> {
  return cached(`store:slug:${slug}`, async () => {
    const [row] = await db.select().from(schema.stores).where(eq(schema.stores.slug, slug)).limit(1);
    return row ? toStoreInfo(row) : null;
  });
}

/** The resolved store for an incoming request, or null (→ 404). Cached per host. */
export async function getStoreByHost(host: string | null | undefined): Promise<StoreInfo | null> {
  const h = normalizeHost(host);
  return cached(`store:host:${h}`, async () => {
    const candidates = [
      await slugFromCustomDomain(h),
      slugFromBaseDomain(h),
      slugFromFirstLabel(h),
    ].filter((s): s is string => Boolean(s));

    for (const slug of candidates) {
      const s = await getStoreBySlug(slug);
      if (s) return s;
    }

    // The host NAMED a store (…and it doesn't exist) → 404. Never silently fall back to another
    // merchant's storefront on someone else's hostname.
    if (candidates.length > 0) return null;

    // No store in the host at all (`localhost:4327`, bare IP, plain `tokophi.com`) → the fallback
    // env keeps local dev + today's single-tenant box working exactly as before.
    const fallback = env("STORE_SLUG") || env("DEFAULT_STORE_SLUG");
    return fallback ? await getStoreBySlug(fallback) : null;
  });
}

/**
 * The store's PRIMARY origin — the single host its pages are canonical on.
 *
 * Every store is permanently reachable at `<slug>.tokophi.com`. When a merchant attaches a custom
 * domain, the identical catalogue becomes reachable at TWO hosts. If both are indexable, Google sees a
 * complete duplicate of every product page and splits the ranking signal between them — the merchant
 * ends up competing with themselves. So exactly one host must be canonical, and canonicals, `og:url`
 * and the sitemap must all be built from it, never from whichever host the request arrived on.
 *
 * TODAY: no custom domains exist (`slugFromCustomDomain()` above is still a stub), so the subdomain is
 * the primary and this returns the requested origin unchanged. That is deliberate and matches the
 * product decision: the subdomain IS the primary until a merchant sets a custom domain in the seller
 * dashboard — which does not exist yet either.
 *
 * WHEN `stores.custom_domain` LANDS, this becomes:
 *     if (store.customDomain) return `https://${store.customDomain}`;
 * and every URL the storefront emits follows automatically, because they all come through here.
 * The subdomain must then either 301 to the custom domain, or serve `rel=canonical` pointing at it —
 * see specs/docs/CUSTOM_DOMAIN.md.
 */
export function primaryOrigin(_store: StoreInfo, requestedOrigin: string): string {
  return requestedOrigin;
}
