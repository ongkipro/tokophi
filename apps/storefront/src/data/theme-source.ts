// T-9 / UX-1 — which `page_templates` a storefront renders. Decision B, as recorded 2026-08-06:
// "A store with no theme of its own shall render the platform default; a store that has customised
// its theme shall keep what it customised until it is deliberately reset."
//
// ⚠️ SEMANTIC CHANGE (2026-08-12), deliberate. The first shipped mechanism (`themeSourceStoreId`,
// PR #220) was an UNCONDITIONAL OVERRIDE — every store rendered the named store's theme, own rows
// unserved. That was B-hard, pointed at `batik-nusantara` live, and its own doc comment said what to
// do the day that store became a real merchant's shop: copy the rows into a platform-owned holder.
// That day did NOT come — owner decision 2026-08-12: the batik store (slug now `batiknusantara`)
// REMAINS the demo store. The holder was built anyway, because pointing a platform-wide default at
// ANY live store's rows was the wrong shape regardless of whose store it is.
// The holder exists now (`seed-platform-theme.ts`), and the override becomes what the
// decision statement actually says: a per-slot FALLBACK. A store's own default slot wins when it has
// content; an empty slot renders the holder's row. A store that customised (e.g. valoish-store)
// gets its own theme back the moment this deploys with the env repointed at the holder.
//
// Its own module, with NO `@tokophi/db` import, on purpose: this is a pure decision and pulling the
// DB client in to test it is what made the first version untestable — the import threw on
// DATABASE_URL before a single assertion ran, and a mutation test then "failed" for the wrong
// reason, which is worse than no test because it looks like proof.

// Same permissive shape as apps/admin/lib/uuid.ts (can't import across apps): "will Postgres accept
// this", not "is this well-formed v4". A non-UUID env value used to flow straight into the query and
// 22P02-throw a 500 on EVERY storefront page; now it reads as OFF, which is the safe failure.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The holder store whose rows back every empty default slot — or null for OFF.
 *
 * **Off by default.** Unset — and blank/whitespace, which is how a var declared in Coolify and left
 * empty arrives — means every store reads only its own templates, exactly as before. Set it to the
 * holder's `stores.id` (`PLATFORM_THEME_STORE_ID` in `@tokophi/lib/platform-theme`) to give every
 * store the platform default underneath its own work.
 */
export const platformDefaultThemeStoreId = (
  raw: string | undefined = process.env.PLATFORM_DEFAULT_THEME_STORE_ID,
): string | null => {
  const id = raw?.trim();
  return id && UUID.test(id) ? id : null;
};

/** The slots `getStoreTemplates` resolves — structural, so this module needs no DB types. */
export type ThemeSlots<T> = {
  homepage: T | null;
  categoryDefault: T | null;
  productDefault: T | null;
  byId: Record<string, T>;
};

/**
 * Decision B itself: per DEFAULT SLOT, the store's own content wins; only an empty slot falls back
 * to the platform holder's row.
 *
 * `byId` stays the store's OWN, never merged: named templates are the target of the store's own
 * `collections/products.template_id` FKs, which can only point at its own rows — and folding another
 * tenant's rows into a merchant's id-space is exactly the "a default must not leak one tenant's
 * content as another's" line T-9 was constrained by (the holder is platform-owned, but the rule is
 * cheaper to keep than to argue per-case).
 */
export const withPlatformFallback = <T>(own: ThemeSlots<T>, platform: ThemeSlots<T>): ThemeSlots<T> => ({
  homepage: own.homepage ?? platform.homepage,
  categoryDefault: own.categoryDefault ?? platform.categoryDefault,
  productDefault: own.productDefault ?? platform.productDefault,
  byId: own.byId,
});

/** Is there any slot left for the platform default to fill? False ⇒ skip the holder query entirely. */
export const needsPlatformFallback = <T>(own: ThemeSlots<T>): boolean =>
  own.homepage === null || own.categoryDefault === null || own.productDefault === null;
