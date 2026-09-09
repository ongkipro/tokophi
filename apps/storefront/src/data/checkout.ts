// The abandoned-cart RECOVERY read (`?r=<signed token>` on /checkout).
//
// It lived inline in `checkout.astro`, which made that page the only `.astro` PAGE in the storefront
// importing `@tokophi/db` — every other page reads through this directory (page-map report SF-7).
// The API endpoints keep their own queries on purpose (endpoint-as-data-layer); a page does not.
//
// THE TENANT BINDING IS THE POINT OF PUTTING THE WHOLE THING HERE. The token is an HS256 JWT bound
// to (session id, store id) — NOT a raw session id, which would hand anyone who sees the URL a
// stranger's name, phone and address. Verifying it and reading the row are one operation: split
// across two modules, a future caller could reach the second half with a session id it did not
// prove. `storeId` is ALSO an explicit WHERE, not a reliance on the token alone — the storefront
// reads as OWNER (the tenant is already resolved from the Host header), so there is no RLS behind
// this to catch a missing predicate.
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import { verifyRecoveryToken } from "../lib/recovery";

// The snapshot shape written by `api/checkout-session.ts`. Every field is nullable because it is
// JSON a previous deploy wrote, not a column the database types for us.
type SnapshotItem = { handle: string | null; name: string | null; variant: string | null; qty: number; price: number };

export type RecoveredCheckout = {
  sessionId: string;
  // No `image`: the snapshot deliberately does not carry one (it stays the documented
  // {handle,name,variant,qty,price} shape). The page re-resolves it from the live catalog so a
  // re-shot photo shows up correctly.
  items: { handle: string; name: string; variant: string; qty: number; price: number }[];
  name: string; phone: string; email: string; address: string;
  city: string; province: string; postcode: string; destId: number | null;
};

/**
 * Resolve a recovery link. A bad, expired, spent or other-tenant token returns `null` — the caller
 * renders the ordinary empty checkout, never an error: the shopper clicked a link from WhatsApp and
 * has nothing to fix.
 */
export async function getRecoveredCheckout(token: string, storeId: string): Promise<RecoveredCheckout | null> {
  const sid = await verifyRecoveryToken(token, storeId);
  if (!sid) return null;

  const [row] = await db
    .select()
    .from(schema.checkoutSessions)
    .where(and(eq(schema.checkoutSessions.storeId, storeId), eq(schema.checkoutSessions.sessionId, sid)))
    .limit(1);
  // `pulih` = already bought. Re-hydrating that cart would push the shopper to buy it twice.
  if (!row || row.status === "pulih") return null;

  const snap = (Array.isArray(row.items) ? row.items : []) as SnapshotItem[];
  return {
    sessionId: sid,
    items: snap
      .filter((i) => i?.name && i.qty > 0)
      .map((i) => ({
        handle: i.handle ?? "",
        name: i.name ?? "",
        variant: i.variant ?? "",
        qty: i.qty,
        price: i.price,
      })),
    name: row.name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    city: row.city ?? "",
    province: row.province ?? "",
    postcode: row.postcode ?? "",
    destId: row.districtId ?? null,
  };
}
