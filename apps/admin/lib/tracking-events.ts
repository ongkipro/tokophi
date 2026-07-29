import "server-only";
import { db, schema } from "@tokophi/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { purchaseEventId, retailerId } from "@tokophi/lib/tracking-ids";

// Server-side Purchase enqueue (ADR 0012 §14.4, §23) — the ONE place a conversion becomes a job.
//
// WHY IT IS SERVER-SIDE: the browser's success page is not evidence that a sale happened. The order
// row is. So the facts below (value, items, order number) are read back from the DB, never taken from
// the request that created them.
//
// ⚠️ OWNER CONNECTION, EXPLICIT store_id. This runs from public API routes and the payment callback,
// where no seller session exists — the documented exception (§0.4), same as `/api/public/order`.
// Every query here therefore carries `store_id` in its WHERE clause. RLS is the net; this is the rule.
//
// TRIGGER POLICY (signed off 2026-07-29):
//   • COD          → enqueued at ORDER CREATION (the thanks page IS the conversion).
//   • Prepaid (VA/QRIS/e-wallet) → enqueued when the gateway callback confirms payment.
// Both use the same `event_id` as the browser pixel, so a provider counts ONE purchase either way.

/**
 * Browser context, captured at checkout because it does not exist any more by the time the cron runs.
 * Meta documents `client_user_agent` as required for website events and `fbp`/`fbc` as its strongest
 * match keys; GA4 needs the real `_ga` client id or every order becomes a brand-new user.
 *
 * ⚠️ These ARE personal-ish data (an IP and a device string). They are stored on the delivery row only
 * because the send is asynchronous, they are never rendered anywhere, and the row is operational — see
 * the retention note in specs/docs/SCHEMA.md. Nothing else about the shopper is persisted here.
 */
export type ClientContext = {
  userAgent?: string | null;
  ip?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  gaClientId?: string | null;
  sourceUrl?: string | null;
};

/** Opaque pass-through values — bound in length so a hostile client cannot inflate the row. */
export function clientContextFromRequest(
  req: Request,
  ip: string | null,
  cookies: { fbp?: unknown; fbc?: unknown; ga?: unknown } | undefined,
): ClientContext {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 256) : null);
  const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? null;
  return {
    userAgent: str(req.headers.get("user-agent")),
    // `clientIp()` returns the literal "unknown" when no proxy header is present (local traffic, or a
    // prod path where Traefik dropped it). Meta VALIDATES `client_ip_address` — sending "unknown" risks
    // a permanent 400 on every conversion. An absent field is honest; a placeholder is a lie that also
    // defeats the "did this event have any match key at all?" check.
    ip: ip && ip !== "unknown" ? ip : null,
    fbp: str(cookies?.fbp),
    fbc: str(cookies?.fbc),
    gaClientId: str(cookies?.ga),
    // Meta requires `event_source_url` on website events. The checkout's own origin is the honest
    // answer — the sale happened on the storefront the shopper was standing on.
    sourceUrl: origin ? origin.slice(0, 512) : null,
  };
}

export type PurchaseFacts = {
  eventId: string;
  contentIds: string[];
  numItems: number;
  value: number;
  currency: "IDR";
  orderNumber: string;
  occurredAt: Date;
  email: string | null;
  phone: string | null;
};

/**
 * Read the order back and build the normalized purchase. Returns null when the order does not belong
 * to the store (or does not exist) — a caller can never talk another tenant's order into an event.
 */
export async function purchaseFacts(storeId: string, orderId: string): Promise<PurchaseFacts | null> {
  const [order] = await db
    .select({
      number: schema.orders.number,
      total: schema.orders.totalIdr,
      placedAt: schema.orders.placedAt,
      phone: schema.orders.shipPhone,
      customerId: schema.orders.customerId,
    })
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.storeId, storeId)))
    .limit(1);
  if (!order) return null;

  // The order's lines. `order_line_items` has no `store_id` (the CHILD-TABLE class), so it is read
  // ONLY by `orderId` — an id whose ownership was just proven by the store-scoped query above. That
  // proof is the tenant boundary here; do not "simplify" it away.
  const lines = await db
    .select({ variantId: schema.orderLineItems.variantId, qty: schema.orderLineItems.qty })
    .from(schema.orderLineItems)
    .where(eq(schema.orderLineItems.orderId, orderId));
  const boughtIds = lines.map((l) => l.variantId).filter((v): v is string => !!v);

  let contentIds: string[] = [];
  // `numItems` counts ONLY the lines that produced a content id. Summing every line instead would report
  // `num_items: 3` next to two ids whenever a line's variant was hard-deleted (or predates variants),
  // and the provider silently mis-attributes the difference.
  let numItems = 0;
  if (boughtIds.length) {
    // Catalog ids for the purchased variants. `rank` reproduces the feed's ordinal exactly: variants
    // ordered by `position` (ties broken by id so the number is stable across runs), 1-based, and only
    // when the product actually has more than one variant — see @tokophi/lib/tracking-ids. The window
    // must see EVERY sibling variant of a purchased product (that is what makes `variantCount` right),
    // so it ranks over the products those variants belong to, then keeps the bought rows.
    const siblingProducts = db
      .select({ pid: schema.productVariants.productId })
      .from(schema.productVariants)
      .where(inArray(schema.productVariants.id, boughtIds));
    const ranked = await db
      .select({
        variantId: schema.productVariants.id,
        handle: schema.products.handle,
        rank: sql<number>`row_number() over (partition by ${schema.productVariants.productId} order by ${schema.productVariants.position}, ${schema.productVariants.id})`,
        variantCount: sql<number>`count(*) over (partition by ${schema.productVariants.productId})`,
      })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      // …and still store-scoped, so a variant id that somehow pointed elsewhere yields no id at all
      // rather than leaking another tenant's product handle into this store's conversion.
      .where(and(eq(schema.products.storeId, storeId), inArray(schema.productVariants.productId, siblingProducts)));

    const byVariant = new Map(ranked.map((r) => [r.variantId, r]));
    let dropped = 0;
    for (const l of lines) {
      const r = l.variantId ? byVariant.get(l.variantId) : undefined;
      if (!r) {
        dropped += 1;
        continue;
      }
      contentIds.push(retailerId(r.handle, Number(r.rank) - 1, Number(r.variantCount)));
      numItems += l.qty ?? 0;
    }
    // A dropped line means the conversion under-reports what was actually bought. Silent is how that
    // stays broken for months — one line, ids only, no customer data.
    if (dropped) console.warn(`[tracking] order=${orderId} store=${storeId}: ${dropped} line(s) had no resolvable catalog id`);
  }

  // Advanced matching is opt-in per channel; the raw values are read here and hashed inside the
  // sender (lib/capi.ts). They are NEVER written to the delivery row.
  let email: string | null = null;
  if (order.customerId) {
    const [c] = await db
      .select({ email: schema.customers.email })
      .from(schema.customers)
      .where(and(eq(schema.customers.id, order.customerId), eq(schema.customers.storeId, storeId)))
      .limit(1);
    email = c?.email ?? null;
  }

  return {
    eventId: purchaseEventId(order.number),
    contentIds,
    numItems,
    value: Number(order.total ?? 0),
    currency: "IDR",
    orderNumber: order.number,
    occurredAt: order.placedAt ?? new Date(), // the ORDER's time — providers reject a stale event_time
    email,
    phone: order.phone ?? null,
  };
}

/**
 * Queue one delivery per channel the merchant has switched server-side tracking on for.
 * Idempotent by `unique(store_id, channel, event_id)` — an AutoLaris callback retry, a double
 * checkout submit, or a re-run of this function cannot produce a second conversion.
 *
 * NON-FATAL by contract: callers wrap it in try/catch. A marketing table must never fail an order.
 */
/** Rows created on hold sit here until `releasePurchase` moves them; ~100 years out, i.e. never. */
const HOLD_UNTIL = new Date("2126-01-01T00:00:00Z");

export async function enqueuePurchase(
  storeId: string,
  orderId: string,
  client?: ClientContext,
  opts?: { hold?: boolean },
): Promise<PurchaseFacts | null> {
  // Channels FIRST — this runs inline on the checkout's hot path, and building the facts costs four
  // queries (order, line items, a window over the catalog, customer). A store with no tracking at all
  // configured must pay none of them.
  const configured = await db
    .select({ channel: schema.storeTrackingChannels.channel, capi: schema.storeTrackingChannels.capiEnabled })
    .from(schema.storeTrackingChannels)
    .where(
      and(
        eq(schema.storeTrackingChannels.storeId, storeId),
        // Either half is enough to need the ids: a browser-only store still needs `content_ids` and the
        // shared `event_id` echoed back to it.
        sql`(${schema.storeTrackingChannels.enabled} or ${schema.storeTrackingChannels.capiEnabled})`,
        sql`nullif(btrim(${schema.storeTrackingChannels.pixelId}), '') is not null`,
      ),
    );
  if (configured.length === 0) return null;

  const facts = await purchaseFacts(storeId, orderId);
  if (!facts) return null;

  // Server-side delivery needs a token as well as a pixel id.
  const channels = await db
    .select({ channel: schema.storeTrackingChannels.channel })
    .from(schema.storeTrackingChannels)
    .where(
      and(
        eq(schema.storeTrackingChannels.storeId, storeId),
        eq(schema.storeTrackingChannels.capiEnabled, true),
        sql`${schema.storeTrackingChannels.capiTokenCiphertext} is not null`,
        // …and a pixel/dataset id to send it TO. Without one the row is enqueued only to dead-letter at
        // the first attempt — noise in the merchant's health panel that describes nothing they did.
        sql`nullif(btrim(${schema.storeTrackingChannels.pixelId}), '') is not null`,
      ),
    );
  if (channels.length === 0) return facts; // browser pixel may still be on — the caller needs the ids

  await db
    .insert(schema.trackingEventDeliveries)
    .values(
      channels.map((c) => ({
        storeId,
        channel: c.channel,
        eventName: "Purchase",
        eventId: facts.eventId,
        orderId,
        // A PREPAID order is queued HERE, at checkout, because this is the only moment the shopper's
        // browser context exists — but held until the gateway callback confirms the money
        // (`releasePurchase`). Enqueuing it in the callback instead would mean every prepaid conversion
        // travels without a user agent, an IP or the Meta cookies, and Meta documents the user agent as
        // required for website events. An order that is never paid simply keeps a held row.
        nextAttemptAt: opts?.hold ? HOLD_UNTIL : new Date(),
        // Commerce facts only. No email, no phone, no token (§9.4 — data minimisation).
        payload: {
          value: facts.value,
          currency: facts.currency,
          contentIds: facts.contentIds,
          numItems: facts.numItems,
          orderNumber: facts.orderNumber,
          occurredAt: facts.occurredAt.toISOString(),
          // Match keys, not identity: UA/IP/cookies the providers require to attribute the sale.
          ...(client ? { client } : {}),
        },
      })),
    )
    .onConflictDoNothing({
      target: [
        schema.trackingEventDeliveries.storeId,
        schema.trackingEventDeliveries.channel,
        schema.trackingEventDeliveries.eventId,
      ],
    });

  return facts;
}

/**
 * The money landed: let this order's held deliveries go. Called from the payment callback.
 *
 * It is deliberately NOT gated on "did this callback change anything" — the callback's own
 * `ne(status, mapped)` guard means a transition happens exactly once, so if the enqueue had been
 * attached to it, one failed attempt would lose that order's conversion permanently (the retry sees no
 * transition and does nothing). This runs on every PAID callback and is idempotent: it only moves rows
 * that are still `queued` and still held, and a row already released or delivered is untouched.
 *
 * Also creates the rows if they are missing — a store that switched server-side tracking on between
 * checkout and payment still gets its conversion, just without the browser context.
 */
export async function releasePurchase(storeId: string, orderId: string): Promise<void> {
  const released = await db
    .update(schema.trackingEventDeliveries)
    .set({ nextAttemptAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.trackingEventDeliveries.storeId, storeId),
        eq(schema.trackingEventDeliveries.orderId, orderId),
        eq(schema.trackingEventDeliveries.status, "queued"),
        sql`${schema.trackingEventDeliveries.nextAttemptAt} > now() + interval '1 day'`,
      ),
    )
    .returning({ id: schema.trackingEventDeliveries.id });
  // ALWAYS, not only when nothing was released: a store that switched a SECOND channel on between
  // checkout and payment has one row to release and one that was never created. `onConflictDoNothing`
  // makes the extra call free.
  await enqueuePurchase(storeId, orderId);
  void released;
}
