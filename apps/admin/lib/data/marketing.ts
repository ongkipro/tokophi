import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// /pemasaran data layer — what is REAL and what is NOT.
//
// NOT REAL (never served from here again): ad spend, impressions, clicks, ad
// "conversions", ad revenue, ROAS, campaign lists, Pixel/CAPI ids. There is NO
// Meta / Google Ads / TikTok integration anywhere in this codebase (the only
// OAuth we have is Google *Sign-In*, lib/google.ts), so those numbers cannot be
// fetched or computed from anything. The `ad_channels` / `ad_metrics` tables
// still hold seeded demo values (spend 18,5jt → revenue 78,2jt, ROAS 4,2× …) —
// pure fabrication. The tables stay (schema is shared), but the UI must never
// present those columns as fact. A merchant could raise a real ad budget on a
// return that never happened.
//
// REAL: `orders.channel` (enum meta_ads | google_ads | tiktok_ads | organic |
// other) is stored per order, so orders + revenue *attributed* to a channel are
// counted from the store's own orders — the same source /analitik uses for
// "Sumber penjualan". That is the only ad-related figure we may show, and it
// says nothing about spend or ROAS (we do not know what was spent).
// ---------------------------------------------------------------------------

export type AdChannelKey = "meta" | "google" | "tiktok";

export type AdChannelStatus = {
  key: AdChannelKey;
  name: string;
  brand: string;
  pixelLabel: string;
  /** True only when a real integration credential exists. None exists today. */
  connected: boolean;
  /** REAL — non-cancelled orders whose `orders.channel` points at this channel. */
  orders: number;
  /** REAL — sum of `orders.total_idr` for those orders (IDR). */
  revenue: number;
};

const ORDER: Record<string, number> = { meta: 0, google: 1, tiktok: 2 };

// `orders.channel` value that corresponds to each ad channel key.
const ORDER_CHANNEL: Record<AdChannelKey, string> = {
  meta: "meta_ads",
  google: "google_ads",
  tiktok: "tiktok_ads",
};

/**
 * The credential store for ad platforms. It is EMPTY and there is no writer: no
 * OAuth flow, no token table, no ad-platform client exists. It is typed as a map
 * so the seam is obvious — when a real integration lands, fill it (from env or a
 * credentials table) and `isConnected` starts returning true on its own.
 *
 * `ad_channels.connected` is deliberately NOT consulted: it is a seeded demo
 * boolean and asserting an integration that does not exist is the whole bug.
 */
const AD_CREDENTIALS: Partial<Record<AdChannelKey, { accessToken: string }>> = {};

/** A channel counts as connected ONLY when a real integration credential exists. */
function isConnected(key: AdChannelKey): boolean {
  return AD_CREDENTIALS[key] != null;
}

const isAdChannelKey = (k: string): k is AdChannelKey => k in ORDER_CHANNEL;

// Channel list = labels/branding from `ad_channels` + REAL attributed sales from
// `orders`. The seeded spend/impressions/clicks/conversions/revenue/pixel columns
// on `ad_channels` are intentionally NOT read.
export async function getAdChannels(): Promise<AdChannelStatus[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = await db.select().from(schema.adChannels);

    const attributed = (await db.execute(sql`
      select o.channel::text                    as "channel",
             count(*)::int                      as "orders",
             coalesce(sum(o.total_idr), 0)::bigint as "revenue"
      from orders o
      where o.status <> 'batal'
      group by 1
    `)) as unknown as { channel: string; orders: number; revenue: string | number }[];

    const byChannel = new Map(attributed.map((r) => [r.channel, r]));

    return rows
      .filter((r) => isAdChannelKey(r.key))
      .map((r) => {
        const key = r.key as AdChannelKey;
        const hit = byChannel.get(ORDER_CHANNEL[key]);
        return {
          key,
          name: r.name ?? "",
          brand: r.brand ?? "#666",
          pixelLabel: r.pixelLabel ?? "",
          connected: isConnected(key),
          orders: hit?.orders ?? 0,
          revenue: Number(hit?.revenue ?? 0),
        };
      })
      .sort((a, b) => (ORDER[a.key] ?? 9) - (ORDER[b.key] ?? 9));
  });
}
