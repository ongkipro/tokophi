// T-9 / UX-1 — which store's `page_templates` a storefront actually renders (decision B-hard).
//
// Its own module, with NO `@tokophi/db` import, on purpose: this is a pure decision and pulling the DB
// client in to test it is what made the first version untestable — the import threw on DATABASE_URL
// before a single assertion ran, and a mutation test then "failed" for the wrong reason, which is worse
// than no test because it looks like proof.

/**
 * Every storefront renders ONE theme: the platform default. A store's own rows are NOT served while
 * this is on — deliberately, on the owner's instruction ("timpa yang sudah punya template").
 *
 * **Render-time only.** Nothing is deleted; unsetting the variable restores every merchant's own theme
 * on the next request. Their rows are the only record that they built anything.
 *
 * **Off by default.** Unset — the shipped state — means each store reads its own templates, exactly as
 * before. Set it to the demo store's id to serve that theme everywhere.
 *
 * ⚠️ This makes the named store's Store Builder a PLATFORM-WIDE control: editing its theme changes
 * every storefront, with no review step and nothing in the audit trail saying so. That is only
 * acceptable because `batiknusantara` is OUR demo store (confirmed by the owner, 2026-08-07). **If it
 * ever becomes a real merchant's shop, copy its rows into a platform-owned holder rather than pointing
 * at it live.**
 */
export const themeSourceStoreId = (
  storeId: string,
  override: string | undefined = process.env.PLATFORM_DEFAULT_THEME_STORE_ID,
): string => {
  const id = override?.trim();
  return id ? id : storeId;
};
