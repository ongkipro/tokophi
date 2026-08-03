/**
 * IS THIS A PRODUCT THE OLD PDP SIZE PICKER COULD HAVE POISONED A CART WITH — and is it therefore
 * safe to clear that cart line's `variant`?
 *
 * `products.sizes` is a legacy DISPLAY-ONLY jsonb column (`["All Size"]`, `["S","M","L"]`) that was
 * never reconciled with `product_variants`. Until 2026-08-03 `produk/[handle].astro` rendered it as an
 * "Ukuran" picker for any product with no `product_options` rows, and `addToCart` parked the chosen
 * SIZE STRING in `cart.variant`. `/api/public/order` requires an exact `product_variants.title` match
 * — deliberately, because a silently re-substituted variant is how a shopper gets charged for
 * something they did not choose — and every one of those products has exactly ONE variant, titled
 * `Default`. So the cart said "All Size", the database said "Default", and the order was refused at
 * Bayar with advice ("Muat ulang halaman produk") that cannot work, because reloading restores the
 * same string from localStorage. Measured on production 2026-08-03: **10 of batik-nusantara's 22
 * active products unbuyable, 0 line items ever sold between them** against 170 for the other 12.
 *
 * **Both halves of the test are load-bearing.**
 * · `sizes.length > 0` — only those products ever had a picker to be poisoned by.
 * · `variants.length <= 1` — with one variant there is nothing to substitute: clearing the line
 *   resolves to the same single row `/api/public/order` takes for an unnamed line. Drop this half and
 *   a stale "Hitam / L" on a real 12-variant product would be silently re-pointed at position 0 —
 *   client-side, which is exactly the harm the endpoint's anti-substitution rule exists to prevent.
 *
 * PURE, and in `lib/` rather than beside `inStock` in `data/catalog.ts`, for the same reason
 * `platform-rank.ts` and `@tokophi/lib/password` are split out: `catalog.ts` imports `@tokophi/db` at
 * module scope, so anything living in it needs a database to be *imported* — and a rule that cannot
 * be imported without a database is a rule nobody writes a test for.
 */
export const noVariantChoice = (p: { sizes?: string[]; variants?: unknown[] }): boolean =>
  (p.sizes?.length ?? 0) > 0 && (p.variants?.length ?? 0) <= 1;
