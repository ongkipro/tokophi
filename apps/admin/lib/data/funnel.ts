import "server-only";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { sql } from "drizzle-orm";

// Conversion funnel + device split, COUNTED from analytics_events (migration 0037 added `device`).
//
// These two cards used to render hardcoded constants (FUNNEL = 18.816 kunjungan…, DEVICE_SPLIT =
// 78/18/4) that were identical for every store. They live in their own file rather than in
// data/analytics.ts because they are the only aggregates that come from EVENTS instead of orders.
//
// The numbers reconcile with the KPIs on the same screen — by construction, not by luck:
//     visit    events == analytics_daily.visitors  (the "Pengunjung" KPI)
//     purchase events == analytics_daily.orders    (the "Pesanan" KPI)
// so the funnel can never contradict the cards next to it.
//
// Rows are DAY-BUCKETED: /analitik filters by the range switcher on the client (same contract as
// `days`), so aggregate these in the client and the range actually changes the numbers.
//
// The storefront tracker is LIVE (`apps/storefront/src/pages/api/track.ts`, since b7ae0ff): it writes
// real `analytics_events` as shoppers browse (bot + rate gated, fail-quiet). In production these cards
// reflect live traffic; locally the seed also loads events so the demo has parity. No query change was
// needed — the shape was the real one from the start.

export const FUNNEL_STEPS = [
  { type: "visit", label: "Kunjungan" },
  { type: "product_view", label: "Lihat Produk" },
  { type: "add_to_cart", label: "Tambah ke Keranjang" },
  { type: "checkout_start", label: "Mulai Checkout" },
  { type: "purchase", label: "Pembelian" },
] as const;

export type FunnelDay = { date: string; type: string; count: number };
export type DeviceDay = { date: string; device: string; count: number };

/** Funnel step counts per day. Client sums over the selected range, in FUNNEL_STEPS order. */
export async function getFunnelDaily(): Promise<FunnelDay[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select to_char(ts, 'YYYY-MM-DD') as "date",
             type                      as "type",
             count(*)::int             as "count"
      from analytics_events
      group by 1, 2
    `)) as unknown as { date: string; type: string; count: number }[];
    return rows.map((r) => ({ date: r.date, type: r.type, count: Number(r.count) }));
  });
}

/**
 * Device split per day. Counts `visit` events only, and the seed pins one device per SESSION —
 * so this is a share of SESSIONS, not of clicks (which would over-weight whoever browsed most).
 */
export async function getDeviceDaily(): Promise<DeviceDay[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select to_char(ts, 'YYYY-MM-DD')            as "date",
             coalesce(nullif(device, ''), 'lainnya') as "device",
             count(*)::int                        as "count"
      from analytics_events
      where type = 'visit'
      group by 1, 2
    `)) as unknown as { date: string; device: string; count: number }[];
    return rows.map((r) => ({ date: r.date, device: r.device, count: Number(r.count) }));
  });
}
