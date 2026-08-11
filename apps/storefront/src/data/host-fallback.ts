// SEC-6 — may this host be answered with the DEFAULT store, or must it 404?
//
// Pure: no db, no env read, so it is testable without a database. Same reason `isPubliclyServable`
// (SEC-1), `servableVerdict` (DOM-3) and `themeSourceStoreId` (T-9) are their own modules.
//
// 🔴 WHY THIS EXISTS. `getStoreByHost` fell through to `STORE_SLUG` for ANY host that produced no
// candidate slug. Observed live on 2026-08-11: with a Traefik router in place and its `store_domains`
// row still `verifying`, `https://beautyinu.co` answered 200 with Batik Nusantara's catalogue — one
// merchant's domain serving another merchant's shop. The guard above it ("never silently fall back to
// another merchant's storefront on someone else's hostname") never fired, because it only runs when
// candidates EXIST. The comment named the intended cases — localhost, bare IP, plain apex — but
// nothing checked for them.
//
// ⚠️ Default to REFUSING. A host we cannot explain is a host we must not answer: the cost of a wrong
// 404 is a puzzled developer, and the cost of a wrong 200 is one merchant's customers reading another
// merchant's shop on a domain they trusted.

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Zones the PLATFORM owns. A host inside one of these cannot be a merchant's own domain, so answering
 * it with the configured default store is safe — that is how `toko.tokophi.com` (the demo shop) and the
 * base apex have always worked. Mirrors `PLATFORM_ZONES` in `apps/admin/lib/data/domain.ts`, which
 * refuses to let a merchant register any host under them.
 *
 * ⚠️ It is a LIST, not the base domain alone: `STOREFRONT_BASE_DOMAIN` is `tokophi.id`, and
 * `toko.tokophi.com` is under a DIFFERENT zone. Deriving from the base domain would 404 the demo store.
 */
export const PLATFORM_ZONES = ["tokophi.id", "tokophi.com", "tokophi.cc"] as const;

const underZone = (h: string, zone: string) => {
  const z = zone.trim().toLowerCase();
  return !!z && (h === z || h.endsWith(`.${z}`));
};

/**
 * True only for hosts that cannot belong to a merchant: local development, a bare IP, the `.sslip.io`
 * convenience, or anything inside a platform-owned zone.
 *
 * `host` must already be normalised (lowercased, port and trailing dot stripped). `extraZones` lets a
 * deploy add a zone without a code change; the built-in list is the floor, never replaced.
 */
export const isNamelessHost = (host: string, extraZones: readonly string[] = []): boolean => {
  const h = host.trim();
  if (!h) return true; // no Host header at all — local tooling, curl, health checks
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || IPV4.test(h)) return true;
  if (h.endsWith(".sslip.io")) return true;
  return [...PLATFORM_ZONES, ...extraZones].some((z) => underZone(h, z));
};
