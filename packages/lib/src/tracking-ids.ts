// The identifiers the whole catalog + conversion stack agrees on (ADR 0012 §0.2, §14.3; ADR 0013).
// Shared by: the product feeds (`/feed/google.xml`, `/feed/tiktok.xml`), the storefront pixel, the
// order API and the CAPI cron. They MUST come from here — two copies of this rule is how a merchant's
// catalog silently splits into two sets of products and every conversion stops matching an item.

/** Which identifier a store publishes. Per store, because switching is a one-way door (see below). */
export type CatalogIdScheme = "handle" | "number";

/**
 * Catalog item id — the primary key of a product in Google Merchant Center, Meta Commerce and TikTok
 * Catalog Manager, and the `content_ids` value every conversion must repeat.
 *
 * **`number` (ADR 0013, the scheme every new store gets):** `{product.number}-{variant.seq}`. Both are
 * system-generated and allocate-once, so renaming the product, reordering its variants or deleting a
 * sibling leaves every surviving id byte-identical. Always suffixed — including single-variant
 * products — because the alternative re-keys the item the day a merchant adds their first variant.
 *
 * **`handle` (legacy, existing stores only):** what the feed emitted before — `handle`, or
 * `handle-{ordinal}` for the n-th variant. It is derived from things a merchant edits, so an ordinary
 * one-click edit re-keys the item. Kept because switching a live catalog is destructive: Google
 * "overwrites your product and its history", Meta deletes and recreates the item, and any retargeting
 * audience built on the old ids goes cold. No provider offers a re-key. The merchant chooses when.
 *
 * ⚠️ The scheme is a PARAMETER, never an `if` at a call site: the feed's `<g:id>` and the pixel's
 * `content_ids` must flip in the same instant for a store. A mismatch does not degrade matching — it
 * silently zeroes it, which is strictly worse than the re-key.
 *
 * Length: `1042-3` is far inside Google's 1–50 char limit (the binding one; Meta and TikTok allow 100)
 * and is plain ASCII alphanumeric + `-`, which is what Google recommends.
 */
export function retailerId(
  scheme: CatalogIdScheme,
  p: { handle: string; number: number },
  v: { seq: number; index: number; count: number },
): string {
  if (scheme === "number") return `${p.number}-${v.seq}`;
  return v.count > 1 ? `${p.handle}-${v.index + 1}` : p.handle;
}

/**
 * The variant group (`item_group_id`). Under `number` it is always emitted, so a product that gains
 * its first variant does not change grouping; under `handle` it is only meaningful for a product that
 * already has several variants, which is the legacy behaviour the feed shipped with.
 */
export function itemGroupId(
  scheme: CatalogIdScheme,
  p: { handle: string; number: number },
  variantCount: number,
): string | null {
  if (scheme === "number") return String(p.number);
  return variantCount > 1 ? p.handle : null;
}

/**
 * The de-duplication key for a sale. The browser pixel and the server-side conversion send this SAME
 * string (`eventID` for Meta/TikTok), which is the only reason one purchase is not counted twice.
 *
 * Built from the ORDER NUMBER ALONE. ADR 0012 §14.3 suggests `purchase:{store_id}:{order_id}`, but
 * `orders.number` carries a UNIQUE constraint across the whole platform (`orders_number_unique`), so
 * the store namespace adds no collision resistance — and it would publish the tenant's primary key
 * into the shopper's browser, their localStorage, and the logs of three ad platforms. Nothing in the
 * system authorizes on `stores.id`, so that is disclosure rather than a hole; but an identifier handed
 * to Meta cannot be un-handed.
 */
export function purchaseEventId(orderNumber: string): string {
  return `purchase:${orderNumber}`;
}
