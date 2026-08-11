// Host → store resolution (ADR 0009 / PROD_PLAN §5): ONE storefront deploy serves EVERY store,
// the tenant is resolved from the request's `Host` header at request time — no per-client build,
// no STORE_SLUG-per-deploy, no DB access at `astro build` time.
//
//   1. active custom domain   — `toko-pelanggan.com` → `store_domains`
//   2. store subdomain        — `<slug>.<STOREFRONT_BASE_DOMAIN>`
//   3. sslip.io development   — `<slug>.127.0.0.1.sslip.io`
//   4. fallback env           — STORE_SLUG / DEFAULT_STORE_SLUG (localhost / bare IP)
// Nothing matches → null → middleware renders a clean 404 ("Toko tidak ditemukan"), never a crash.
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { cached } from "./cache";
import { RESERVED_SLUGS } from "@tokophi/lib/store-slug";
import { isPubliclyServable, lockReason, type LockReason } from "./store-servable";
import { isNamelessHost } from "./host-fallback";

/** The three product-gallery layouts a merchant can pick in Tema (mirrors `stores.product_gallery_layout`). */
export type GalleryLayout = "thumbnail-left" | "thumbnail-bottom" | "grid";
const GALLERY_LAYOUTS: readonly GalleryLayout[] = ["thumbnail-left", "thumbnail-bottom", "grid"];
/** Clamp an arbitrary DB string to a known layout — an unrecognised value falls back to the default. */
export const asGalleryLayout = (v: string | null | undefined): GalleryLayout =>
  GALLERY_LAYOUTS.includes(v as GalleryLayout) ? (v as GalleryLayout) : "thumbnail-left";

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
   * PUBLIC shop email — correspondence a shopper may write to (migration 0070). `null`/blank = not
   * published → render no email row. ⚠️ NEVER `users.email`: that one is a LOGIN CREDENTIAL, unique
   * across the platform, and putting it in a public footer would publish a sign-in identifier.
   */
  email: string | null;
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
   * Design-token choices beyond the brand colour (`stores.theme` jsonb, migration 0092). Passed
   * raw — `resolveTheme()` (@tokophi/lib/theme) validates and defaults it at render time, so an
   * unknown value degrades to the original look instead of crashing every page of the store.
   */
  theme: unknown;
  /** Product-page gallery layout the merchant picked in Tema. Unknown DB values clamp to the default. */
  productGalleryLayout: GalleryLayout;
  /**
   * The store's PRIMARY custom host, or null. When set, the storefront's canonical/og:url/sitemap use
   * `https://<primaryHost>` and every OTHER host 301s to it (CUSTOM_DOMAIN.md §2). null → the
   * `<slug>.tokophi.com` subdomain IS the primary, and `primaryOrigin()` returns the request origin.
   */
  primaryHost: string | null;
  /**
   * Which identifier this store's product feeds publish (ADR 0013): `"number"` = the stable
   * `{product.number}-{variant.seq}`, `"handle"` = the legacy handle-derived id. Per store because
   * switching re-keys an already-ingested catalog, which no provider can undo.
   */
  catalogIdScheme: string;
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
//
// The list moved to `@tokophi/lib/store-slug` so the two store-CREATION paths can consult it too:
// nothing did, so a shop called "App" was written with `slug: "app"` and the line below then refused
// to resolve it — a storefront that 404s on its own subdomain, with no screen saying why.
const RESERVED = RESERVED_SLUGS;

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
 * First label of an sslip.io development host (`<slug>.203.0.113.10.sslip.io`).
 *
 * This used to accept `<slug>.anything.else`. Once the custom-domain catch-all router exists, that
 * would let an unregistered hostname whose first label happened to equal a store slug bypass the
 * `store_domains status='active'` gate. Production domains must resolve through the explicit base or
 * active custom-domain paths; this convenience is only for the named development service.
 */
function slugFromFirstLabel(host: string): string | null {
  if (!host.endsWith(".sslip.io")) return null;
  const first = host.split(".")[0];
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
  email: r.email,
  socialInstagram: r.socialInstagram,
  socialTiktok: r.socialTiktok,
  socialFacebook: r.socialFacebook,
  socialPinterest: r.socialPinterest,
  socialX: r.socialX,
  catalogIdScheme: r.catalogIdScheme,
  logoUrl: r.logoUrl,
  faviconUrl: r.faviconUrl,
  brandColor: r.brandColor,
  theme: r.theme,
  productGalleryLayout: asGalleryLayout(r.productGalleryLayout),
  primaryHost: null, // filled by the caller (getStoreBySlug) — a per-store store_domains lookup
});

export async function getStoreBySlug(slug: string): Promise<StoreInfo | null> {
  return cached(`store:slug:${slug}`, async () => {
    const [row] = await db.select().from(schema.stores).where(eq(schema.stores.slug, slug)).limit(1);
    if (!row) return null;
    // SEC-1 — a LOCKED store is not served to the public. Self-serve signup creates a store suspended
    // and unapproved, and this function filtered on slug alone, so every pending signup's catalogue was
    // fully browsable the moment the row existed. Same answer as "no such store": null → 404, so a
    // locked shop is not distinguishable from one that never existed.
    if (!isPubliclyServable(row)) return null;
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

/** Every slug a host could name, most specific first. Shared so the locked-store lookup below cannot
 *  drift from the real resolver — if they disagreed, a locked shop would 404 instead of explaining. */
async function candidateSlugs(h: string): Promise<string[]> {
  return [await slugFromCustomDomain(h), slugFromBaseDomain(h), slugFromFirstLabel(h)].filter(
    (x): x is string => Boolean(x),
  );
}

/** The resolved store for an incoming request, or null (→ 404). Cached per host. */
export async function getStoreByHost(host: string | null | undefined): Promise<StoreInfo | null> {
  const h = normalizeHost(host);
  return cached(`store:host:${h}`, async () => {
    const candidates = await candidateSlugs(h);

    for (const slug of candidates) {
      const s = await getStoreBySlug(slug);
      if (s) return s;
    }

    // The host NAMED a store (…and it doesn't exist) → 404. Never silently fall back to another
    // merchant's storefront on someone else's hostname.
    if (candidates.length > 0) return null;

    // SEC-6 — the fallback is for hosts that carry NO store name (`localhost:4327`, a bare IP, the
    // base apex). It used to apply to ANY host that produced no candidate, which meant a merchant's
    // own domain — routed here but not yet `active` — was answered with the DEFAULT store's shop.
    // Observed live on beautyinu.co, 2026-08-11. A host we cannot explain must be refused.
    if (!isNamelessHost(h, [normalizeHost(env("STOREFRONT_BASE_DOMAIN"))])) return null;
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

/**
 * SEC-1 follow-up — the host names a real store that is LOCKED, so we can say so instead of a bare
 * "tidak ditemukan". Returns null for a host that names nothing.
 *
 * ⚠️ SEPARATE from `getStoreBySlug` ON PURPOSE. That function still returns null for a locked store,
 * so the catalogue stays unreachable BY CONSTRUCTION — there is no path where this lookup can hand a
 * locked store to the catalogue layer. It reads a name and a reason, nothing else.
 */
export async function getLockedStoreByHost(
  host: string | null | undefined,
): Promise<{ name: string; reason: LockReason } | null> {
  const h = normalizeHost(host);
  for (const slug of await candidateSlugs(h)) {
    const [row] = await db
      .select({ name: schema.stores.name, suspendedAt: schema.stores.suspendedAt, approvedAt: schema.stores.approvedAt })
      .from(schema.stores)
      .where(eq(schema.stores.slug, slug))
      .limit(1);
    if (row && !isPubliclyServable(row)) return { name: row.name, reason: lockReason(row) };
  }
  return null;
}
