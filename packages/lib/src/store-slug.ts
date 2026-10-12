/**
 * A STORE'S PUBLIC URL — one slugify, one reserved list, read by everything that mints or resolves
 * one. Pure: no DB import, same split as `platform-rank.ts` and `password.ts`.
 *
 * ⚠️ THERE WERE TWO SLUGIFYS AND THEY HAD ALREADY DRIFTED. `apps/admin/lib/provision.ts` (self-serve
 * signup) normalised NFKD; `apps/super-admin/lib/actions.ts` `createStore` (an operator onboarding a
 * merchant by hand) did not. Measured on the two implementations as they stood:
 *
 *     "Café Senja"    → self-serve `cafe-senja`      · operator `caf-senja`
 *     "Toko Ibu Éni"  → self-serve `toko-ibu-e-ni`   · operator `toko-ibu-ni`
 *
 * Two doors onto the same product, two different answers for a shop's permanent public address —
 * and a slug is not a display string that can be fixed later: it is the subdomain, the sitemap and
 * every link anyone has shared.
 *
 * ⚠️ AND NEITHER ONE WAS RIGHT. NFKD decomposes `É` into `E` + a combining acute, and the combining
 * mark is not `[a-z0-9]`, so it became a SEPARATOR: `Éni` → `e-ni`. Stripping the marks (U+0300–036F)
 * after decomposing is what makes NFKD do the job it was reached for. Indonesian rarely carries
 * diacritics, but shop names do — and every borrowed word, owner's name and café in the country goes
 * through this function.
 */
import { PLATFORM_THEME_SLUG } from "./platform-theme";

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    // The combining marks NFKD just split off — DROP them, never let them become a separator.
    // Written as escapes on purpose: a literal combining character in source is invisible in every
    // editor and diff, which is not a property you want in the rule that mints a permanent URL.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Slugs a store may not hold, because the storefront refuses to RESOLVE them as one.
 *
 * `apps/storefront/src/data/store.ts` has always used this list to stop a platform hostname
 * (`app.`, `rich.`, `www.`…) being read as a merchant's subdomain. Nothing consulted it on the way
 * IN: both store-creation paths would happily write `slug: "app"` for a shop called "App", and the
 * result is a store whose storefront is structurally unreachable — a 404 on its own subdomain, with
 * nothing on any screen saying why — while the platform loses that hostname for good.
 *
 * ⚠️ It is EXACTLY the storefront's list and it must stay that way: the entries are the ones with a
 * demonstrated consequence. Widening it (`mail`, `cdn`, `blog`, `help`…) is a product decision with
 * a real cost — every added word is a shop name somebody is refused — and it must not be done
 * casually here just because this is where the set now lives.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "rich",
  "admin",
  "api",
  "cname",
  "toko",
  "storefront",
  "localhost",
  // The platform default theme holder (`platform-theme.ts`). Not a hostname convention like the
  // rest: it protects a FIXED slug the deploy seed (`seed-platform-theme.ts`) must be able to
  // insert — `stores.slug` is unique, so a merchant registering "tema-platform" first would make
  // that seed fail on every deploy, silently (the chain runs it non-fatal). Reserving it also keeps
  // the holder from ever resolving as a merchant subdomain, on top of its `suspendedAt` lock.
  PLATFORM_THEME_SLUG,
  // The demo store's PRE-RENAME slug (2026-08-12, `batik-nusantara` → `batiknusantara`). The rename
  // freed the string, and `slugify("Batik Nusantara")` mints exactly it — but the storefront
  // middleware answers `batik-nusantara.<base>` with a permanent 301 to the DEMO store's host
  // BEFORE it resolves a tenant, so a merchant allocated this slug would get a subdomain that
  // forever serves somebody else's shop. The demonstrated consequence this list requires; reserved
  // for as long as that redirect exists (apps/storefront/src/middleware.ts, OLD_LABEL).
  "batik-nusantara",
  // The Seller help center (`apps/docs`, Task 8.37) is served on `panduan.tokophi.com` by an explicit
  // Traefik Host router that outranks the store wildcard. A store allocated this slug would lose its
  // `.tokophi.com` alias to the docs site, and `panduan.tokophi.id` would read as TokoΦ's official
  // guide while serving a merchant's shop.
  "panduan",
]);

export const isReservedSlug = (slug: string): boolean => RESERVED_SLUGS.has(slug);

/**
 * What a store's name and its owner's name may be.
 *
 * The floor was enforced in `registerStore` only, so the GOOGLE signup path — which takes the store
 * name from the Google profile and never passes through that function — skipped it entirely. There
 * was no ceiling anywhere: both columns are `text()`, and the only bound in the system was Next's
 * server-action body limit. The value reaches `stores.name`, `accounts.name` and the
 * `platform_activity` line the control plane reads.
 *
 * 60 is the cap `MAX_NAME` in the storefront's chat already uses for a person's name — same job,
 * same number, rather than a second opinion about how long a name gets to be.
 */
export const STORE_NAME_MIN = 3;
export const NAME_MAX = 60;
