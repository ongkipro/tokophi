/**
 * Is this path segment a UUID we can safely put in front of `eq(table.id, …)`?
 *
 * Postgres rejects a non-UUID string for a `uuid` column with `22P02 invalid input syntax for type
 * uuid` — a THROW, not an empty result — so a route that passes the raw segment straight through
 * renders a 500 where it should render a 404.
 *
 * This is not theoretical here: `/produk/…` takes the catalog NUMBER (ADR 0013), which teaches
 * merchants that "a product is a number", so `/promo/1042` gets tried. `promo/[id]` guarded itself
 * and wrote down why; the routes beside it did not, and the super-admin's `toko/[id]` / `tiket/[id]`
 * never could — the copy lived in `apps/admin/lib/uuid.ts`, which the control plane may not import.
 * ONE implementation now (page-map findings SA-3 + AD-1); `apps/admin/lib/uuid.ts` re-exports it.
 *
 * Deliberately NOT version- or variant-restricted (`[89ab]` for the RFC 4122 variant nibble): the
 * point is "will Postgres accept this", not "is this a well-formed v4". Rejecting an id the database
 * would have accepted would 404 a real row.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string | undefined | null): boolean => !!s && UUID.test(s);
