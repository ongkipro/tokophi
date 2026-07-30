import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { decryptSecret, secretScope } from "@/lib/crypto";
import { sanitize, sendGa4Purchase, sendMetaPurchase, sendTiktokPurchase, type ServerEvent } from "@/lib/capi";
import { systemDomainFor } from "@/lib/data/domain";
import { enqueuePurchase } from "@/lib/tracking-events";

// CONVERSION DELIVERY WORKER (ADR 0012 §0.1, §16, §23) — the drain half of `tracking_event_deliveries`.
// TokoΦ has no worker process, so this is a secured API route hit on a schedule, exactly like
// `api/cron/tracking`. One tick claims a bounded batch of due rows, sends one provider call per row
// inside its own try/catch, and writes the verdict back. Forward-only and idempotent: a row that has
// already succeeded is never re-sent, and the provider de-duplicates on `event_id` anyway.
//
// ⚠️ CROSS-TENANT BY NECESSITY, SCOPED BY HAND. This drains EVERY store, so it runs on the owner
// connection where RLS does not apply. Every query therefore carries an explicit id — the claim is by
// primary key, and the store's channel config is fetched with `store_id = row.storeId`. Never widen a
// query here to "all rows of table X" without a store filter (§0.1).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap per tick — each row is one live provider call. A CAP, not rate limiting; the fairness ORDER BY
// (oldest due first) is what stops a hot store from starving everyone else.
//
// ⚠️ BATCH × the per-call timeout MUST stay well under STALE_MS, or a slow provider makes a tick
// outlive its own claim: rows it has not reached yet look "stranded" to the next tick, get re-claimed,
// and the same conversion is sent twice. 50 × 10 s ≈ 8 min against a 30 min window.
const BATCH = 50;
const STALE_MS = 30 * 60_000;
// After this many attempts a row is dead-lettered: it stops consuming ticks and starts being visible
// as a failure the merchant can act on, instead of retrying forever in silence.
const MAX_ATTEMPTS = 6;
// Exponential backoff with jitter (§23.2): ~1m, 4m, 9m, 16m, 25m … capped at 6h.
function backoffMs(attempt: number): number {
  const base = Math.min(attempt * attempt * 60_000, 6 * 60 * 60_000);
  return base + Math.floor(Math.random() * 30_000);
}

/**
 * `_ga` is stored as `GA1.1.<clientId>.<timestamp>`; GA4 wants the `<clientId>.<timestamp>` tail.
 * Anything that does not look like that is refused rather than passed through — a malformed client id
 * is accepted by MP with a 204 and then quietly attributed to nobody.
 */
/**
 * The store's public storefront origin. Only needed for delivery rows that carry no captured origin
 * (the payment-callback path), so most ticks never call it.
 *
 * ⚠️ The cache is created PER TICK and passed in — it used to be a module-level `Map`, which outlives
 * the request in a long-running container, so a store that changed its slug kept sending the old
 * `event_source_url` until the next deploy. `cfgCache` is per-tick for the same reason (a re-pasted
 * token has to take effect on the next tick, not on the next release).
 */
async function storefrontUrl(storeId: string, cache: Map<string, string>): Promise<string> {
  const hit = cache.get(storeId);
  if (hit !== undefined) return hit;
  const [s] = await db.select({ slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const url = s?.slug ? `https://${systemDomainFor(s.slug)}/` : "";
  cache.set(storeId, url);
  return url;
}

function ga4ClientId(raw?: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^GA\d+\.\d+\.(\d+\.\d+)$/);
  if (m) return m[1];
  return /^\d+\.\d+$/.test(raw) ? raw : null;
}

type Payload = {
  value?: number;
  goods?: number;
  shipping?: number;
  tax?: number;
  lineItems?: { id: string; price?: number; qty?: number }[];
  currency?: string;
  contentIds?: string[];
  numItems?: number;
  orderNumber?: string;
  occurredAt?: string;
  client?: { userAgent?: string; ip?: string; fbp?: string; fbc?: string; gaClientId?: string; ttp?: string; ttclid?: string; sourceUrl?: string };
};

export async function GET(req: NextRequest) {
  // FAIL CLOSED in production, exactly like cron/tracking and cron/billing.
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron/tracking-events] CRON_SECRET unset in production — REJECTING.");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // ── RECONCILE, BEFORE THE CLAIM ─────────────────────────────────────────────────────────────────
  // Two ways a real sale could produce no conversion at all, both silent, neither self-healing:
  //
  //  1. A PREPAID order is queued HELD at checkout and released only by the AutoLaris callback. That
  //     webhook is a single un-retried delivery: get the callback secret wrong on a redeploy (it 401s),
  //     or have the gateway drop it, and every prepaid Purchase in that window sits parked at the year
  //     2126 forever. There is no payment poll and no "mark paid" path in the product.
  //  2. `enqueuePurchase` runs AFTER the order transaction commits, inside a try/catch, and costs six
  //     queries. One transient DB blip and it throws — the order is real, `tracking` comes back null, so
  //     the storefront's positive gate suppresses the BROWSER pixel too, and nothing ever back-fills.
  //     Prepaid recovers (the callback enqueues again); COD, where the thanks page IS the conversion,
  //     never does.
  //
  // So: sweep both, bounded by time (older than a week is past Meta's event window anyway) and by row
  // count, and cross-tenant with the store id carried explicitly on every predicate.
  let released = 0;
  let backfilled = 0;
  try {
    const rel = await db.execute(sql`
      update tracking_event_deliveries d
         set next_attempt_at = now(), updated_at = now()
        from orders o
       where d.order_id = o.id
         and d.store_id = o.store_id
         and d.status = 'queued'
         and d.next_attempt_at > now() + interval '1 day'
         and o.financial_status = 'dibayar'
         and o.placed_at > now() - interval '7 days'`);
    released = rel.length ?? 0;
  } catch (err) {
    console.error("[cron/tracking-events] release sweep failed", err);
  }
  try {
    // A COD order counts at the thanks page; a prepaid one only once the money landed. Anything else
    // (an unpaid VA) is correctly left alone — this sweep must never invent a conversion.
    const missing = (await db.execute(sql`
      select o.id::text as id, o.store_id::text as store_id
        from orders o
       where o.placed_at > now() - interval '3 days'
         and not exists (select 1 from tracking_event_deliveries d where d.order_id = o.id)
         and exists (
               select 1 from store_tracking_channels c
                where c.store_id = o.store_id and c.capi_enabled
                  and c.capi_token_ciphertext is not null
                  and nullif(btrim(c.pixel_id), '') is not null)
         and (o.financial_status = 'dibayar'
              or exists (select 1 from payments p where p.order_id = o.id and p.method = 'cod'))
       order by o.placed_at desc
       limit 20`)) as unknown as { id: string; store_id: string }[];
    for (const m of missing) {
      // No browser context — it is long gone. A conversion with weaker match keys beats no conversion.
      const facts = await enqueuePurchase(m.store_id, m.id);
      if (facts) backfilled++;
    }
    if (missing.length) console.warn(`[cron/tracking-events] backfilled ${backfilled}/${missing.length} order(s) that had no delivery row`);
  } catch (err) {
    console.error("[cron/tracking-events] backfill sweep failed", err);
  }

  // CLAIM — ONE atomic `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`.
  //
  // ⚠️ This MUST stay a single statement. A SELECT-then-UPDATE cannot be made safe here: two ticks
  // (a slow run overlapping the next 60 s sidecar wake-up) would read the same ids, both pass the
  // status re-check, and both send — a double-counted Purchase in the merchant's ad reporting. The
  // sub-SELECT's `FOR UPDATE SKIP LOCKED` is what hands each row to exactly one tick.
  //
  // Due = queued/failed whose backoff has elapsed, plus `processing` stranded past STALE_MS (a tick
  // that crashed mid-send must not park a conversion forever). Oldest due first, so no store starves.
  //
  // The claim INCREMENTS `attempt_count`. It used to be written only on the way out, so a tick killed
  // mid-send (deploy, OOM, request abort) left the row at its old count — re-claimed, re-sent, killed
  // again, forever, with `MAX_ATTEMPTS` structurally unreachable and a poison row at the head of the
  // ORDER BY blocking every other store. Counting the ATTEMPT, not the outcome, is what terminates.
  const stale = new Date(now.getTime() - STALE_MS);
  const claimed = await db
    .update(schema.trackingEventDeliveries)
    .set({ status: "processing", attemptCount: sql`${schema.trackingEventDeliveries.attemptCount} + 1`, updatedAt: new Date() })
    .where(
      inArray(
        schema.trackingEventDeliveries.id,
        // ⚠️ ISO strings + an explicit cast, NOT Date objects. A `Date` bound into a RAW `sql` fragment
        // throws `ERR_INVALID_ARG_TYPE` at runtime while typechecking perfectly — the whole cron 500s
        // and not one conversion is ever delivered. Caught only by running it (2026-07-29).
        sql`(
          select d.id from tracking_event_deliveries d
          where (d.status in ('queued','failed') and d.next_attempt_at <= ${now.toISOString()}::timestamptz)
             or (d.status = 'processing' and d.updated_at <= ${stale.toISOString()}::timestamptz)
          order by d.next_attempt_at asc
          limit ${BATCH}
          for update skip locked
        )`,
      ),
    )
    .returning({
      id: schema.trackingEventDeliveries.id,
      storeId: schema.trackingEventDeliveries.storeId,
      channel: schema.trackingEventDeliveries.channel,
      eventId: schema.trackingEventDeliveries.eventId,
      eventName: schema.trackingEventDeliveries.eventName,
      orderId: schema.trackingEventDeliveries.orderId,
      attemptCount: schema.trackingEventDeliveries.attemptCount,
      payload: schema.trackingEventDeliveries.payload,
    });

  if (claimed.length === 0) return NextResponse.json({ ok: true, claimed: 0, sent: 0, failed: 0, dead: 0, released, backfilled });

  let sent = 0;
  let failed = 0;
  let dead = 0;

  // Channel config is per store; cache it for this tick so 50 orders from one shop are one read.
  const cfgCache = new Map<string, { pixelId: string | null; token: string | null; advancedMatching: boolean; testEventCode: string | null } | null>();
  const originCache = new Map<string, string>();
  async function config(storeId: string, channel: "meta" | "google" | "tiktok") {
    const key = `${storeId}:${channel}`;
    if (cfgCache.has(key)) return cfgCache.get(key)!;
    const [row] = await db
      .select({
        pixelId: schema.storeTrackingChannels.pixelId,
        cipher: schema.storeTrackingChannels.capiTokenCiphertext,
        capiEnabled: schema.storeTrackingChannels.capiEnabled,
        advancedMatching: schema.storeTrackingChannels.advancedMatching,
        testEventCode: schema.storeTrackingChannels.testEventCode,
      })
      .from(schema.storeTrackingChannels)
      // EXPLICIT store scope — this is the owner connection (see the header note).
      .where(and(eq(schema.storeTrackingChannels.storeId, storeId), eq(schema.storeTrackingChannels.channel, channel)))
      .limit(1);
    // A merchant who switched CAPI off (or disconnected) must stop receiving deliveries (§17.3).
    const value =
      row && row.capiEnabled
        ? { pixelId: row.pixelId, token: decryptSecret(row.cipher, secretScope(storeId, channel)), advancedMatching: row.advancedMatching, testEventCode: row.testEventCode }
        : null;
    cfgCache.set(key, value);
    return value;
  }

  for (const row of claimed) {
    // Already incremented BY the claim — `RETURNING` gives the post-update row. Adding one here would
    // double-count every attempt and halve the retry budget.
    const attempt = row.attemptCount;
    try {
      const cfg = await config(row.storeId, row.channel as "meta" | "google" | "tiktok");
      if (!cfg || !cfg.pixelId || !cfg.token) {
        // Configuration gone or unreadable: switched off, token cleared, or `INTEGRATION_TOKEN_KEY`
        // rotated without the token being re-entered. Retried on a slow clock rather than dead-lettered
        // at once — the cause is usually a window a human is in the middle of closing (a redeploy, a
        // paste of the new token), and a conversion that heals itself beats one that needs a button.
        // It still terminates: MAX_ATTEMPTS applies, and the message says what to do.
        const message = "Pelacakan sisi server nonaktif atau token tidak terbaca — simpan ulang token di Pemasaran → Pelacakan.";
        if (attempt >= MAX_ATTEMPTS) {
          await finish(row.id, attempt, { status: "dead_letter", code: "not_configured", message });
          dead++;
        } else {
          await finish(row.id, attempt, { status: "failed", code: "not_configured", message, retryInMs: 60 * 60_000 });
          failed++;
        }
        continue;
      }

      const p = (row.payload ?? {}) as Payload;
      // Identity is fetched FRESH (never stored on the delivery row) and hashed inside the sender.
      // Always, not only under "advanced matching": a server-side conversion carries no browser cookie,
      // so without a hashed email/phone Meta has nothing to match on and rejects the event outright.
      // The Seller's advanced-matching switch governs the BROWSER pixel.
      let identity: ServerEvent["identity"];
      if (row.orderId) {
        const [o] = await db
          .select({ phone: schema.orders.shipPhone, customerId: schema.orders.customerId })
          .from(schema.orders)
          .where(and(eq(schema.orders.id, row.orderId), eq(schema.orders.storeId, row.storeId)))
          .limit(1);
        let email: string | null = null;
        if (o?.customerId) {
          const [c] = await db
            .select({ email: schema.customers.email })
            .from(schema.customers)
            .where(and(eq(schema.customers.id, o.customerId), eq(schema.customers.storeId, row.storeId)))
            .limit(1);
          email = c?.email ?? null;
        }
        identity = { email, phone: o?.phone ?? null };
      }

      const event: ServerEvent = {
        eventName: "Purchase",
        eventId: row.eventId,
        eventTime: Math.floor(new Date(p.occurredAt ?? Date.now()).getTime() / 1000),
        value: Number(p.value ?? 0),
        // Absent on rows queued before these fields existed — the senders fall back to `value`.
        ...(typeof p.goods === "number" ? { goods: p.goods } : {}),
        ...(typeof p.shipping === "number" ? { shipping: p.shipping } : {}),
        ...(typeof p.tax === "number" ? { tax: p.tax } : {}),
        ...(Array.isArray(p.lineItems) ? { lineItems: p.lineItems } : {}),
        currency: p.currency ?? "IDR",
        contentIds: Array.isArray(p.contentIds) ? p.contentIds : [],
        numItems: Number(p.numItems ?? 0),
        orderNumber: String(p.orderNumber ?? ""),
        sourceUrl: p.client?.sourceUrl,
        // Meta requires `event_source_url` and TikTok requires `page.url` on every website event. A row
        // created by the payment-callback release path carries no origin, so the store's own storefront
        // is the honest fallback — it IS where the sale happened. Only looked up when the row has no
        // captured origin: it used to be awaited for EVERY row, which is one query per delivery for a
        // value almost none of them use.
        ...(p.client?.sourceUrl ? {} : { fallbackUrl: await storefrontUrl(row.storeId, originCache) }),
        identity,
        client: p.client,
      };

      const res =
        row.channel === "meta"
          ? await sendMetaPurchase({ pixelId: cfg.pixelId, accessToken: cfg.token, testEventCode: cfg.testEventCode, event })
          : row.channel === "tiktok"
            ? await sendTiktokPurchase({ pixelId: cfg.pixelId, accessToken: cfg.token, event, testEventCode: cfg.testEventCode })
            : await sendGa4Purchase({
                measurementId: cfg.pixelId,
                apiSecret: cfg.token,
                // GA4's client id is the `_ga` cookie's `GA1.1.<id>.<ts>` → the `<id>.<ts>` part. With
                // it, the purchase joins the session the shopper actually browsed in; without it GA4
                // mints a brand-new user per order and the traffic source lands on "(not set)". The
                // order number is only the last resort (a store whose shopper blocked the cookie).
                clientId: ga4ClientId(p.client?.gaClientId) ?? String(p.orderNumber ?? row.eventId),
                event,
              });

      if (res.ok) {
        await db
          .update(schema.trackingEventDeliveries)
          .set({ status: "succeeded", attemptCount: attempt, deliveredAt: new Date(), updatedAt: new Date(), lastErrorCode: null, lastErrorMessage: null })
          .where(eq(schema.trackingEventDeliveries.id, row.id));
        sent++;
      } else if (!res.retryable || attempt >= MAX_ATTEMPTS) {
        await finish(row.id, attempt, { status: "dead_letter", code: res.errorCode ?? "permanent", message: res.errorMessage ?? "" });
        dead++;
      } else {
        await finish(row.id, attempt, { status: "failed", code: res.errorCode ?? "retry", message: res.errorMessage ?? "", retryInMs: backoffMs(attempt) });
        failed++;
      }
      // One greppable line per delivery — ids and status only, never a payload or a token (§24.1).
      console.log(
        `[cron/tracking-events] store=${row.storeId} channel=${row.channel} event=${row.eventName} attempt=${attempt} ok=${res.ok}${res.ok ? "" : ` code=${res.errorCode ?? "?"}`}`,
      );
    } catch (err) {
      // An unexpected throw is OUR bug, not the provider's verdict — retry it, bounded.
      const message = sanitize(err instanceof Error ? err.message : String(err));
      if (attempt >= MAX_ATTEMPTS) {
        await finish(row.id, attempt, { status: "dead_letter", code: "exception", message });
        dead++;
      } else {
        await finish(row.id, attempt, { status: "failed", code: "exception", message, retryInMs: backoffMs(attempt) });
        failed++;
      }
      console.error(`[cron/tracking-events] store=${row.storeId} channel=${row.channel} threw on attempt ${attempt}`);
    }
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, sent, failed, dead, released, backfilled });
}

/**
 * Write a row's verdict. NEVER throws.
 *
 * ⚠️ It used to. The claim increments `attempt_count` for all 50 rows at once (deliberately — see the
 * note above it), which is only sound if every claimed row gets a verdict in the same tick. `finish()`
 * sat inside the per-row `catch` and was not itself guarded, so one DB blip while writing a verdict
 * escaped the `for` loop and 500'd the route: the ~45 rows the tick had not reached yet kept
 * `status='processing'` with an attempt already spent, waited out STALE_MS, were re-claimed, and spent
 * another. Six such ticks and their FIRST real send landed on `attempt >= MAX_ATTEMPTS` — instantly
 * dead-lettered, carrying an error from a failure that was never theirs.
 */
async function finish(
  id: string,
  attempt: number,
  o: { status: "failed" | "dead_letter"; code: string; message: string; retryInMs?: number },
) {
  try {
    await db
      .update(schema.trackingEventDeliveries)
      .set({
        status: o.status,
        attemptCount: attempt,
        // A dead row must never be picked up again: park its clock far in the future rather than rely
        // on the status filter alone.
        nextAttemptAt: new Date(Date.now() + (o.retryInMs ?? 365 * 24 * 3600_000)),
        lastErrorCode: o.code.slice(0, 64),
        lastErrorMessage: o.message.slice(0, 400),
        updatedAt: new Date(),
      })
      .where(eq(schema.trackingEventDeliveries.id, id));
  } catch (err) {
    // Leaving the row `processing` is the safe failure: STALE_MS reclaims it in 30 minutes. Losing the
    // other 49 rows of the batch is not.
    console.error(`[cron/tracking-events] could not write verdict for ${id}`, err);
  }
}
