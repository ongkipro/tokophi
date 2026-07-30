import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// /pemasaran data layer — what is REAL and what is NOT.
//
// NOT REAL (never served from here again): ad spend, impressions, clicks, ad
// "conversions", ad revenue, ROAS, campaign lists. We do not pull SPEND from any
// ad platform and have no plan to, so those columns are structurally empty.
// ⚠️ This comment used to say "there is NO Meta / Google Ads / TikTok integration
// anywhere in this codebase". Since ADR 0012/0013 that is false: pixel + CAPI
// config lives in `store_tracking_channels` (lib/data/tracking.ts), conversions are
// delivered by lib/capi.ts, and the catalog feeds are always on. What is still
// absent is an ad-platform REPORTING integration — the credentials here are pasted
// by the merchant, not OAuthed. The `ad_channels` / `ad_metrics` tables
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

// ⚠️ `AD_CREDENTIALS` / `isConnected()` / `AdChannelStatus.connected` were DELETED (2026-07-31). The map
// was empty with no writer, so `connected` was permanently `false` — and it shipped the "Belum
// terhubung" lie twice: once on the channel cards, once in the CSV export, both on a page rendering
// "Pixel aktif" from the real config beside it. Whether a channel is tracking is answered by
// `getTrackingStatus()` in lib/data/tracking.ts, from `store_tracking_channels`. Do not reintroduce a
// boolean here that nothing true can set: that is the dead-column pattern (`store_settings.
// payment_channels`) which this codebase has now paid for three times.

const isAdChannelKey = (k: string): k is AdChannelKey => k in ORDER_CHANNEL;

// Channel list = labels/branding from `ad_channels` + attributed sales counted from `orders.channel`.
// The seeded spend/impressions/clicks/conversions/revenue/pixel columns on `ad_channels` are
// intentionally NOT read.
//
// ⚠️ WHAT `orders.channel` ACTUALLY IS. Until 2026-07-30 this comment said "REAL", and it was not: the
// column's only writer hard-coded `"organic"`, so on a real store every figure here was 0 forever — and
// the demo store's split came from the seed's `CHANNELS[Math.floor(rnd() * …)]`, i.e. a coin flip
// presented as attribution. It is now written by `lib/ad-channel.ts` at order creation from the
// shopper's own last ad click (`_fbc` / `_gcl_aw` / `ttclid`).
// So it is real, and it is OURS: last-click, first-party, and it will NOT match Meta Ads Manager, which
// models view-throughs, cross-device and a different window. Orders placed before that date keep
// whatever the seed wrote. Say "dari pesanan toko Anda", never "menurut Meta".
export async function getAdChannels(): Promise<AdChannelStatus[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = await db.select().from(schema.adChannels);

    const attributed = (await db.execute(sql`
      select o.channel::text                    as "channel",
             count(*)::int                      as "orders",
             coalesce(sum(o.total_idr - o.tax_idr), 0)::bigint as "revenue"
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
          orders: hit?.orders ?? 0,
          revenue: Number(hit?.revenue ?? 0),
        };
      })
      .sort((a, b) => (ORDER[a.key] ?? 9) - (ORDER[b.key] ?? 9));
  });
}
