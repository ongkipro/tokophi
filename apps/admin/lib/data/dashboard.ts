// Pure derivation utils for Dashboard/Analitik. The data (daily series, products, orders,
// activities) is fetched from the DB in the server wrapper and passed in — no storage access
// here, so these stay callable client-side (the range switcher re-derives on the client).
import { hourlyFor, type DayPoint, type Product, type Order, type Activity } from "@/lib/mock/store";
import type { FunnelDay, DeviceDay } from "@/lib/data/funnel";
import type { ChannelDay, ProductSaleDay } from "@/lib/data/analytics";

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "lastmonth";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Hari ini" },
  { key: "yesterday", label: "Kemarin" },
  { key: "7d", label: "7 Hari Terakhir" },
  { key: "30d", label: "30 Hari Terakhir" },
  { key: "month", label: "Bulan Ini" },
  { key: "lastmonth", label: "Bulan Lalu" },
];

export const rangeLabel = (k: RangeKey) => RANGE_OPTIONS.find((r) => r.key === k)?.label ?? k;

type Resolved = { days: DayPoint[]; prev: DayPoint[]; granularity: "hour" | "day"; compardeLabel: string };

function resolve(all: DayPoint[], key: RangeKey): Resolved {
  const n = all.length;
  const slice = (a: number, b: number) => all.slice(Math.max(0, a), b);
  switch (key) {
    case "today":
      return { days: slice(n - 1, n), prev: slice(n - 2, n - 1), granularity: "hour", compardeLabel: "kemarin" };
    case "yesterday":
      return { days: slice(n - 2, n - 1), prev: slice(n - 3, n - 2), granularity: "hour", compardeLabel: "hari sebelumnya" };
    case "7d":
      return { days: slice(n - 7, n), prev: slice(n - 14, n - 7), granularity: "day", compardeLabel: "7 hari sebelumnya" };
    case "30d":
      return { days: slice(n - 30, n), prev: slice(n - 60, n - 30), granularity: "day", compardeLabel: "30 hari sebelumnya" };
    case "month":
      return { days: all.filter((d) => d.date.startsWith("2026-06")), prev: all.filter((d) => d.date.startsWith("2026-05")), granularity: "day", compardeLabel: "bulan lalu" };
    case "lastmonth":
      return { days: all.filter((d) => d.date.startsWith("2026-05")), prev: all.filter((d) => d.date.startsWith("2026-04")), granularity: "day", compardeLabel: "bulan sebelumnya" };
  }
}

const sum = (arr: DayPoint[], k: keyof Pick<DayPoint, "sales" | "orders" | "visitors">) =>
  arr.reduce((a, d) => a + d[k], 0);

const delta = (cur: number, prev: number) => (prev === 0 ? 0 : ((cur - prev) / prev) * 100);

export type Kpi = { value: number; delta: number };
export type Summary = {
  sales: Kpi;
  orders: Kpi;
  visitors: Kpi;
  conversion: Kpi;
  aov: Kpi;
  compareLabel: string;
};

export function getSummary(all: DayPoint[], key: RangeKey): Summary {
  const { days, prev, compardeLabel } = resolve(all, key);
  const s = sum(days, "sales"), o = sum(days, "orders"), v = sum(days, "visitors");
  const ps = sum(prev, "sales"), po = sum(prev, "orders"), pv = sum(prev, "visitors");
  const conv = v ? (o / v) * 100 : 0;
  const pconv = pv ? (po / pv) * 100 : 0;
  const aov = o ? s / o : 0;
  const paov = po ? ps / po : 0;
  return {
    sales: { value: s, delta: delta(s, ps) },
    orders: { value: o, delta: delta(o, po) },
    visitors: { value: v, delta: delta(v, pv) },
    conversion: { value: conv, delta: delta(conv, pconv) },
    aov: { value: aov, delta: delta(aov, paov) },
    compareLabel: compardeLabel,
  };
}

export type SeriesPoint = { label: string; sales: number; prev: number; orders: number };

export function getSeries(all: DayPoint[], key: RangeKey): { points: SeriesPoint[]; granularity: "hour" | "day" } {
  const { days, prev, granularity } = resolve(all, key);
  if (granularity === "hour") {
    const cur = hourlyFor(days[0]);
    const pv = prev.length ? hourlyFor(prev[0]) : cur.map(() => ({ sales: 0 }));
    return {
      granularity,
      points: cur.map((h, i) => ({ label: h.label, sales: h.sales, prev: pv[i]?.sales ?? 0, orders: h.orders })),
    };
  }
  const fmt = (d: string) => new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  return {
    granularity,
    points: days.map((d, i) => ({ label: fmt(d.date), sales: d.sales, prev: prev[i]?.sales ?? 0, orders: d.orders })),
  };
}

export type TopProduct = { id: string; name: string; emoji: string; image: string; revenue: number; units: number };

// Real revenue per product: order_line_items rows (day-bucketed server-side) summed over the
// selected range. The previous version synthesized this (period total x unitsSold x 1.9).
export function getTopProducts(rows: ProductSaleDay[], key: RangeKey, all: DayPoint[], limit = 5): TopProduct[] {
  const { cur } = rangeDates(all, key);
  const agg = new Map<string, TopProduct>();
  for (const r of rows) {
    if (!cur.has(r.date)) continue;
    const hit = agg.get(r.productId) ?? { id: r.productId, name: r.name, emoji: r.emoji, image: r.image, revenue: 0, units: 0 };
    hit.revenue += r.revenue;
    hit.units += r.units;
    agg.set(r.productId, hit);
  }
  return [...agg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

export type ChannelSlice = { channel: string; value: number };

// Attribution source, COUNTED from the `orders.channel` column (day-bucketed server-side).
// The previous version multiplied the period total by an invented weight vector
// (Meta Ads 34% / Organic 24% / ...), identical for every store.
export function getChannels(rows: ChannelDay[], key: RangeKey, all: DayPoint[]): ChannelSlice[] {
  const { cur } = rangeDates(all, key);
  const agg = new Map<string, number>();
  for (const r of rows) {
    if (!cur.has(r.date)) continue;
    agg.set(r.channel, (agg.get(r.channel) ?? 0) + r.value);
  }
  return [...agg.entries()].map(([channel, value]) => ({ channel, value })).sort((a, b) => b.value - a.value);
}

export function getRecentOrders(orders: Order[], limit = 6) {
  return orders.slice(0, limit);
}
export function getStatusCounts(orders: Order[]) {
  const order: ("baru" | "diproses" | "dikirim" | "selesai" | "batal")[] = ["baru", "diproses", "dikirim", "selesai", "batal"];
  return order.map((s) => ({ status: s, count: orders.filter((o) => o.status === s).length }));
}
export function getActivities(activities: Activity[], limit = 8) {
  return activities.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Event-derived cards (analytics_events, via lib/data/funnel.ts). Everything below is a
// COUNT of rows for the days inside the selected range — so the range switcher actually
// moves the numbers, and the funnel's top/bottom equal the Pengunjung/Pesanan KPIs
// (the seed writes one `visit` event per counted visitor and one `purchase` per counted
// order, so `visit events == analytics_daily.visitors` and `purchase == analytics_daily.orders`).
//
// A store with NO events (every store created via /daftar — the seed only runs on an empty DB)
// gets `null` back, and the UI must render an honest "belum ada data" state.
// ---------------------------------------------------------------------------

/** The set of YYYY-MM-DD dates in the selected range (and the comparison range). */
export function rangeDates(all: DayPoint[], key: RangeKey): { cur: Set<string>; prev: Set<string> } {
  const r = resolve(all, key);
  return { cur: new Set(r.days.map((d) => d.date)), prev: new Set(r.prev.map((d) => d.date)) };
}

const countEvents = (rows: FunnelDay[], dates: Set<string>, type: string) =>
  rows.reduce((a, r) => (r.type === type && dates.has(r.date) ? a + r.count : a), 0);

/** "Pengunjung" KPI — counted `visit` events. `null` when the store has no events at all. */
export function getVisitsKpi(rows: FunnelDay[], all: DayPoint[], key: RangeKey): Kpi | null {
  if (!rows.length) return null;
  const { cur, prev } = rangeDates(all, key);
  const v = countEvents(rows, cur, "visit");
  return { value: v, delta: delta(v, countEvents(rows, prev, "visit")) };
}

/** "Konversi" KPI — counted purchases / counted visits. `null` when there are no events. */
export function getConversionKpi(rows: FunnelDay[], all: DayPoint[], key: RangeKey): Kpi | null {
  if (!rows.length) return null;
  const { cur, prev } = rangeDates(all, key);
  const rate = (d: Set<string>) => {
    const v = countEvents(rows, d, "visit");
    return v ? (countEvents(rows, d, "purchase") / v) * 100 : 0;
  };
  const c = rate(cur);
  return { value: c, delta: delta(c, rate(prev)) };
}

export type FunnelStep = { step: string; count: number };

/** Funnel steps for the range. `null` when the store has no events. */
export function getFunnel(rows: FunnelDay[], all: DayPoint[], key: RangeKey, steps: readonly { type: string; label: string }[]): FunnelStep[] | null {
  if (!rows.length) return null;
  const { cur } = rangeDates(all, key);
  const out = steps.map((s) => ({ step: s.label, count: countEvents(rows, cur, s.type) }));
  return out[0].count === 0 ? null : out;
}

export type DeviceSlice = { device: string; count: number; pct: number };
const DEVICE_LABEL: Record<string, string> = { ponsel: "Ponsel", desktop: "Desktop", tablet: "Tablet", lainnya: "Lainnya" };

/** Device split (share of SESSIONS in the range). `null` when the store has no visit events. */
export function getDeviceSplit(rows: DeviceDay[], all: DayPoint[], key: RangeKey): DeviceSlice[] | null {
  if (!rows.length) return null;
  const { cur } = rangeDates(all, key);
  const agg = new Map<string, number>();
  for (const r of rows) {
    if (!cur.has(r.date)) continue;
    agg.set(r.device, (agg.get(r.device) ?? 0) + r.count);
  }
  const total = [...agg.values()].reduce((a, n) => a + n, 0);
  if (!total) return null;
  return [...agg.entries()]
    .map(([device, count]) => ({ device: DEVICE_LABEL[device] ?? device, count, pct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count);
}
