import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { and, desc, gte, isNotNull, sql } from "drizzle-orm";

// Read the store's marketing-pixel / conversion-tracking config for the Pemasaran → Pelacakan setup.
// The CAPI token ciphertext is NEVER returned to the client — the UI only needs to know whether one is
// stored (`capiConfigured`), so a merchant can tell "a token is saved" without the secret leaving the
// server. (ADR 0012 §9.2: merchant UI reads MUST exclude token ciphertext.)
export type TrackingChannelKey = "meta" | "google" | "tiktok";

export type TrackingConfig = {
  channel: TrackingChannelKey;
  enabled: boolean;
  pixelId: string;
  capiEnabled: boolean;
  /** true = a CAPI token is stored (its value is never sent to the client). */
  capiConfigured: boolean;
  advancedMatching: boolean;
  testEventCode: string;
};

const KEYS: TrackingChannelKey[] = ["meta", "google", "tiktok"];

function empty(channel: TrackingChannelKey): TrackingConfig {
  return { channel, enabled: false, pixelId: "", capiEnabled: false, capiConfigured: false, advancedMatching: false, testEventCode: "" };
}

export async function getTrackingConfig(): Promise<TrackingConfig[]> {
  return withCurrentTenant(async (db: Tx) => {
    // PROJECTED on purpose. A bare `select()` would pull `capiTokenCiphertext` into a value that flows
    // straight into a client component — the mapping below drops it today, and one future `return rows`
    // would ship the secret to the browser. ADR 0012 §9.2: never select the ciphertext into a component.
    const rows = await db
      .select({
        channel: schema.storeTrackingChannels.channel,
        enabled: schema.storeTrackingChannels.enabled,
        pixelId: schema.storeTrackingChannels.pixelId,
        capiEnabled: schema.storeTrackingChannels.capiEnabled,
        // Presence only — `capiConfigured`, never the value.
        hasToken: sql<boolean>`${schema.storeTrackingChannels.capiTokenCiphertext} is not null`,
        advancedMatching: schema.storeTrackingChannels.advancedMatching,
        testEventCode: schema.storeTrackingChannels.testEventCode,
      })
      .from(schema.storeTrackingChannels);
    const byKey = new Map(rows.map((r) => [r.channel, r]));
    // Always return all three channels (a channel with no row yet renders as an empty, off card).
    return KEYS.map((k) => {
      const r = byKey.get(k);
      if (!r) return empty(k);
      return {
        channel: k,
        enabled: r.enabled,
        pixelId: r.pixelId ?? "",
        capiEnabled: r.capiEnabled,
        capiConfigured: !!r.hasToken,
        advancedMatching: r.advancedMatching,
        testEventCode: r.testEventCode ?? "",
      };
    });
  });
}

// ── Server-side delivery diagnostics (ADR 0012 §20.3/§20.4) ──────────────────────────────────────
// What the merchant needs to answer "is my server-side tracking actually working?" — counts by status
// over the last 7 days plus the newest failure's SANITIZED reason. Never a raw provider payload
// (§20.4: "do not show raw provider JSON to merchants"); `lastErrorMessage` was already stripped of
// anything token-shaped by lib/capi.ts before it was persisted.
export type TrackingHealth = {
  channel: TrackingChannelKey;
  queued: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  lastDeliveredAt: Date | null;
  lastError: string | null;
};

export async function getTrackingHealth(): Promise<Record<TrackingChannelKey, TrackingHealth>> {
  const empty = (c: TrackingChannelKey): TrackingHealth => ({
    channel: c,
    queued: 0,
    succeeded: 0,
    failed: 0,
    deadLetter: 0,
    lastDeliveredAt: null,
    lastError: null,
  });
  const out = { meta: empty("meta"), google: empty("google"), tiktok: empty("tiktok") };

  return withCurrentTenant(async (db: Tx) => {
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    // RLS scopes these rows to the session's store; the aggregate is per channel.
    const rows = await db
      .select({
        channel: schema.trackingEventDeliveries.channel,
        status: schema.trackingEventDeliveries.status,
        n: sql<number>`count(*)::int`,
        lastDelivered: sql<Date | null>`max(${schema.trackingEventDeliveries.deliveredAt})`,
      })
      .from(schema.trackingEventDeliveries)
      .where(
        and(
          gte(schema.trackingEventDeliveries.createdAt, since),
          // HELD rows are excluded. A prepaid order that is never paid keeps its row queued in 2126 on
          // purpose — but counting it as "antre" would show the Seller a queue that grows with every
          // abandoned VA screen and never moves, which reads as a broken worker.
          // ⚠️ Scoped to `queued`: `dead_letter` rows are ALSO parked in the future (a year out), and a
          // bare future-date filter would hide exactly the failures this panel exists to surface.
          sql`not (${schema.trackingEventDeliveries.status} = 'queued' and ${schema.trackingEventDeliveries.nextAttemptAt} > now() + interval '1 day')`,
        ),
      )
      .groupBy(schema.trackingEventDeliveries.channel, schema.trackingEventDeliveries.status);

    for (const r of rows) {
      const t = out[r.channel as TrackingChannelKey];
      if (!t) continue;
      const n = Number(r.n);
      if (r.status === "succeeded") t.succeeded += n;
      else if (r.status === "dead_letter") t.deadLetter += n;
      else if (r.status === "failed") t.failed += n;
      else t.queued += n; // queued | processing — both are "waiting" to a merchant
      if (r.lastDelivered && (!t.lastDeliveredAt || r.lastDelivered > t.lastDeliveredAt)) t.lastDeliveredAt = r.lastDelivered;
    }

    // Newest failure per channel — one row each, enough to render a remediation line.
    const errs = await db
      .select({
        channel: schema.trackingEventDeliveries.channel,
        message: schema.trackingEventDeliveries.lastErrorMessage,
        code: schema.trackingEventDeliveries.lastErrorCode,
        updatedAt: schema.trackingEventDeliveries.updatedAt,
      })
      .from(schema.trackingEventDeliveries)
      .where(and(gte(schema.trackingEventDeliveries.createdAt, since), isNotNull(schema.trackingEventDeliveries.lastErrorCode)))
      .orderBy(desc(schema.trackingEventDeliveries.updatedAt))
      .limit(30);
    for (const e of errs) {
      const t = out[e.channel as TrackingChannelKey];
      if (t && !t.lastError) t.lastError = e.message || e.code || null;
    }
    return out;
  });
}

// NOTE: the storefront's copy of "which pixels are public" lives in
// `apps/storefront/src/data/tracking.ts` (`storeTrackingPixels`) — it runs in the Astro app, on the
// owner connection, with an explicit store_id. An unused duplicate used to sit here; two definitions of
// the same rule is exactly the drift the shared `retailerId()` helper exists to prevent.
