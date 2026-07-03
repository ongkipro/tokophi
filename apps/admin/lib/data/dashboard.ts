// Pure derivation utils for Dashboard/Analitik. The data (daily series, products, orders,
// activities) is fetched from the DB in the server wrapper and passed in — no storage access
// here, so these stay callable client-side (the range switcher re-derives on the client).
import { hourlyFor, type DayPoint, type Product, type Order, type Activity } from "@/lib/mock/store";

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

export function getTopProducts(all: DayPoint[], products: Product[], key: RangeKey, limit = 5): TopProduct[] {
  const total = sum(resolve(all, key).days, "sales");
  const ranked = [...products].sort((a, b) => b.unitsSold - a.unitsSold);
  const weightSum = ranked.reduce((a, p) => a + p.unitsSold, 0) || 1;
  return ranked.slice(0, limit).map((p) => {
    const revenue = Math.round(total * (p.unitsSold / weightSum) * 1.9);
    return { id: p.id, name: p.name, emoji: p.emoji, image: p.image, revenue, units: Math.max(1, Math.round(revenue / p.price)) };
  });
}

export type ChannelSlice = { channel: string; value: number };
// Attribution source (where the conversion came from), not a sales channel.
const CHANNEL_WEIGHTS: [string, number][] = [
  ["Meta Ads", 0.34], ["Organic", 0.24], ["Google Ads", 0.18], ["TikTok Ads", 0.16], ["Other", 0.08],
];
export function getChannels(all: DayPoint[], key: RangeKey): ChannelSlice[] {
  const total = sum(resolve(all, key).days, "sales");
  return CHANNEL_WEIGHTS.map(([channel, w]) => ({ channel, value: Math.round(total * w) }));
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
