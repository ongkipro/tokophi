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
import { and, eq } from "drizzle-orm";
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
  /**
   * PUBLIC shop address, free text, 2–4 lines (a textarea in the seller's Pengaturan). `null`/blank =
   * the merchant has not published one → render NOTHING. ⚠️ This is NOT `store_settings.sender_address`
   * (the courier PICKUP point) — most sellers here ship from home, and publishing that would put a
   * private home address on every page of a public website without anyone asking.
   */
  address: string | null;
  /** Public phone (may be a landline). `null` = no phone published → render no phone row. */
  phone: string | null;
  /**
   * Social handles — the USERNAME only (no `@`, no URL); the storefront builds the profile link.
   * `null` for every one is the NORMAL state today: the whole social row disappears, it does not
   * render as an empty strip.
   */
  socialInstagram: string | null;
  socialTiktok: string | null;
  socialFacebook: string | null;
  socialPinterest: string | null;
  socialX: string | null;
  logoUrl: string | null;
  /** `null` = merchant set no favicon → fall back to the platform icon rather than a broken one. */
  faviconUrl: string | null;
  brandColor: string | null;
  /**
   * The store's PRIMARY custom host, or null. When set, the storefront's canonical/og:url/sitemap use
   * `https://<primaryHost>` and every OTHER host 301s to it (CUSTOM_DOMAIN.md §2). null → the
   * `<slug>.tokophi.com` subdomain IS the primary, and `primaryOrigin()` returns the request origin.
   */
  primaryHost: string | null;
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
 * Custom merchant domain (`toko-pelanggan.com`) → store slug, via `store_domains`.
 *
 * Only an `active` row resolves — a domain still `pending`/`verifying`/`provisioning` must NOT serve a
 * store yet (its cert may not exist, and TXT ownership may be unproven). `store_domains.host` is UNIQUE
 * across the platform, so this returns at most one slug and one store can never be served on another's
 * verified host. Owner connection is correct here: an anonymous shopper has no session, exactly like
 * every other read in this file (CUSTOM_DOMAIN.md §1).
 */
async function slugFromCustomDomain(host: string): Promise<string | null> {
  if (!host) return null;
  const [row] = await db
    .select({ slug: schema.stores.slug })
    .from(schema.storeDomains)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.storeDomains.storeId))
    .where(and(eq(schema.storeDomains.host, host), eq(schema.storeDomains.status, "active")))
    .limit(1);
  return row?.slug ?? null;
}

const toStoreInfo = (r: typeof schema.stores.$inferSelect): StoreInfo => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  tagline: r.tagline,
  whatsapp: r.whatsapp,
  city: r.city ?? "",
  address: r.address,
  phone: r.phone,
  socialInstagram: r.socialInstagram,
  socialTiktok: r.socialTiktok,
  socialFacebook: r.socialFacebook,
  socialPinterest: r.socialPinterest,
  socialX: r.socialX,
  logoUrl: r.logoUrl,
  faviconUrl: r.faviconUrl,
  brandColor: r.brandColor,
  primaryHost: null, // filled by the caller (getStoreBySlug) — a per-store store_domains lookup
});

export async function getStoreBySlug(slug: string): Promise<StoreInfo | null> {
  return cached(`store:slug:${slug}`, async () => {
    const [row] = await db.select().from(schema.stores).where(eq(schema.stores.slug, slug)).limit(1);
    if (!row) return null;
    // The store's primary custom host (if any) — only an ACTIVE, is_primary row counts. A domain still
    // verifying or provisioning is not yet the canonical host, or we would 301 shoppers to a host that
    // does not answer.
    const [dom] = await db
      .select({ host: schema.storeDomains.host })
      .from(schema.storeDomains)
      .where(
        and(
          eq(schema.storeDomains.storeId, row.id),
          eq(schema.storeDomains.status, "active"),
          eq(schema.storeDomains.isPrimary, true),
        ),
      )
      .limit(1);
    return { ...toStoreInfo(row), primaryHost: dom?.host ?? null };
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
 * HOW IT RESOLVES: `slugFromCustomDomain()` above reads `store_domains` for a row whose `status='active'`
 * and `StoreInfo.primaryHost` carries that host (or null when the subdomain is still the primary). A
 * merchant attaches and verifies a domain in the seller dashboard (Pengaturan → Domain, `DomainCard`);
 * a verified-but-not-yet-served domain rests at `provisioning` (a TLS cert via Cloudflare-for-SaaS is
 * the last step, not built) and does NOT become `primaryHost` until it is `active`. So a subdomain-only
 * store returns the request origin unchanged; a store with an active primary is canonical there, and the
 * subdomain 301s to it (GET/HEAD only). Every canonical / `og:url` / sitemap URL flows through here, so
 * that switch is centralised — see specs/docs/CUSTOM_DOMAIN.md.
 */
export function primaryOrigin(store: StoreInfo, requestedOrigin: string): string {
  // A store with an active primary custom domain is canonical THERE, always over https. Otherwise the
  // request origin (the <slug>.tokophi.com subdomain, or localhost in dev) is itself the primary.
  return store.primaryHost ? `https://${store.primaryHost}` : requestedOrigin;
}
