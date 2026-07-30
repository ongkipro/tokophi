import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { decryptSecret, secretScope } from "@/lib/crypto";
import { sanitize, sendGa4Purchase, sendMetaPurchase, sendTiktokPurchase, type ServerEvent } from "@/lib/capi";
import { systemDomainFor } from "@/lib/data/domain";

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
 * The store's public storefront origin, cached per tick. Only needed for delivery rows that carry no
 * captured origin (the payment-callback path), so most ticks never call it.
 */
const originCache = new Map<string, string>();
async function storefrontUrl(storeId: string): Promise<string> {
  const hit = originCache.get(storeId);
  if (hit !== undefined) return hit;
  const [s] = await db.select({ slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  const url = s?.slug ? `https://${systemDomainFor(s.slug)}/` : "";
  originCache.set(storeId, url);
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

  if (claimed.length === 0) return NextResponse.json({ ok: true, claimed: 0, sent: 0, failed: 0, dead: 0 });

  let sent = 0;
  let failed = 0;
  let dead = 0;

  // Channel config is per store; cache it for this tick so 50 orders from one shop are one read.
  const cfgCache = new Map<string, { pixelId: string | null; token: string | null; advancedMatching: boolean; testEventCode: string | null } | null>();
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
        currency: p.currency ?? "IDR",
        contentIds: Array.isArray(p.contentIds) ? p.contentIds : [],
        numItems: Number(p.numItems ?? 0),
        orderNumber: String(p.orderNumber ?? ""),
        sourceUrl: p.client?.sourceUrl,
        // Meta requires `event_source_url` and TikTok requires `page.url` on every website event. A row
        // created by the payment-callback release path carries no origin, so the store's own storefront
        // is the honest fallback — it IS where the sale happened.
        fallbackUrl: await storefrontUrl(row.storeId),
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

  return NextResponse.json({ ok: true, claimed: claimed.length, sent, failed, dead });
}

async function finish(
  id: string,
  attempt: number,
  o: { status: "failed" | "dead_letter"; code: string; message: string; retryInMs?: number },
) {
  await db
    .update(schema.trackingEventDeliveries)
    .set({
      status: o.status,
      attemptCount: attempt,
      // A dead row must never be picked up again: park its clock far in the future rather than rely on
      // the status filter alone.
      nextAttemptAt: new Date(Date.now() + (o.retryInMs ?? 365 * 24 * 3600_000)),
      lastErrorCode: o.code.slice(0, 64),
      lastErrorMessage: o.message.slice(0, 400),
      updatedAt: new Date(),
    })
    .where(eq(schema.trackingEventDeliveries.id, id));
}
