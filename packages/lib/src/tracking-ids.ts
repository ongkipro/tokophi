// The two identifiers the whole conversion-tracking stack agrees on (ADR 0012 §0.2, §14.3).
// Shared by: the product feed (`/feed/google.xml`), the storefront pixel, the order API and the CAPI
// cron. They MUST come from here — two copies of this rule is how a merchant's catalog silently
// splits into two sets of products and every conversion stops matching an item.

/**
 * Catalog item id, byte-identical to the `<g:id>` the Google/Meta/TikTok feed already emits:
 * a single-variant product is its `handle`, a multi-variant product's i-th variant is `handle-{i+1}`
 * (1-based, in `position` order — the same order the feed and the PDP render).
 *
 * ⚠️ `// lazy:` this id is HANDLE- and POSITION-dependent by design (§0.2): renaming a handle or
 * reordering variants re-keys the item in the merchant's Meta catalog. That is accepted for MVP
 * because changing it now would orphan every product already ingested from the feed URL. The upgrade
 * path — a stable, handle-independent id on BOTH the feed and the push — is its own ADR + migration.
 */
export function retailerId(handle: string, variantIndex: number, variantCount: number): string {
  return variantCount > 1 ? `${handle}-${variantIndex + 1}` : handle;
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
 * to Meta cannot be un-handed later, and this costs nothing to avoid.
 */
export function purchaseEventId(orderNumber: string): string {
  return `purchase:${orderNumber}`;
}
