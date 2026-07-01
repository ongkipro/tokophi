// Thin data layer over the mock store. Swap the bodies for API/DB calls later;
// component contracts stay the same.
import { DAYS, hourlyFor, PRODUCTS, ORDERS, ACTIVITIES, ONLINE_NOW, CUSTOMER_COUNT, type DayPoint } from "@/lib/mock/store";

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

function resolve(key: RangeKey): Resolved {
  const n = DAYS.length;
  const slice = (a: number, b: number) => DAYS.slice(Math.max(0, a), b);
  switch (key) {
    case "today":
      return { days: slice(n - 1, n), prev: slice(n - 2, n - 1), granularity: "hour", compardeLabel: "kemarin" };
    case "yesterday":
      return { days: slice(n - 2, n - 1), prev: slice(n - 3, n - 2), granularity: "hour", compardeLabel: "hari sebelumnya" };
    case "7d":
      return { days: slice(n - 7, n), prev: slice(n - 14, n - 7), granularity: "day", compardeLabel: "7 hari sebelumnya" };
    case "30d":
      return { days: slice(n - 30, n), prev: slice(n - 60, n - 30), granularity: "day", compardeLabel: "30 hari sebelumnya" };
    case "month": {
      const cur = DAYS.filter((d) => d.date.startsWith("2026-06"));
      const prev = DAYS.filter((d) => d.date.startsWith("2026-05"));
      return { days: cur, prev, granularity: "day", compardeLabel: "bulan lalu" };
    }
    case "lastmonth": {
      const cur = DAYS.filter((d) => d.date.startsWith("2026-05"));
      const prev = DAYS.filter((d) => d.date.startsWith("2026-04"));
      return { days: cur, prev, granularity: "day", compardeLabel: "bulan sebelumnya" };
    }
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

export function getSummary(key: RangeKey): Summary {
  const { days, prev, compardeLabel } = resolve(key);
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

export function getSeries(key: RangeKey): { points: SeriesPoint[]; granularity: "hour" | "day" } {
  const { days, prev, granularity } = resolve(key);
  if (granularity === "hour") {
    const cur = hourlyFor(days[0]);
    const pv = prev.length ? hourlyFor(prev[0]) : cur.map(() => ({ sales: 0 }));
    return {
      granularity,
      points: cur.map((h, i) => ({ label: h.label, sales: h.sales, prev: pv[i]?.sales ?? 0, orders: h.orders })),
    };
  }
  const fmt = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  };
  return {
    granularity,
    points: days.map((d, i) => ({ label: fmt(d.date), sales: d.sales, prev: prev[i]?.sales ?? 0, orders: d.orders })),
  };
}

export type TopProduct = { id: string; name: string; emoji: string; revenue: number; units: number };

export function getTopProducts(key: RangeKey, limit = 5): TopProduct[] {
  const { days } = resolve(key);
  const total = sum(days, "sales");
  const ranked = [...PRODUCTS].sort((a, b) => b.unitsSold - a.unitsSold);
  const weightSum = ranked.reduce((a, p) => a + p.unitsSold, 0);
  return ranked.slice(0, limit).map((p) => {
    const revenue = Math.round(total * (p.unitsSold / weightSum) * 1.9);
    return { id: p.id, name: p.name, emoji: p.emoji, revenue, units: Math.max(1, Math.round(revenue / p.price)) };
  });
}

export type ChannelSlice = { channel: string; value: number };
const CHANNEL_WEIGHTS: [string, number][] = [
  ["Toko Online", 0.44], ["Instagram", 0.21], ["WhatsApp", 0.18], ["TikTok Shop", 0.12], ["Google", 0.05],
];
export function getChannels(key: RangeKey): ChannelSlice[] {
  const total = sum(resolve(key).days, "sales");
  return CHANNEL_WEIGHTS.map(([channel, w]) => ({ channel, value: Math.round(total * w) }));
}

export function getRecentOrders(limit = 6) {
  return ORDERS.slice(0, limit);
}
export function getStatusCounts() {
  const order: ("baru" | "diproses" | "dikirim" | "selesai" | "batal")[] = ["baru", "diproses", "dikirim", "selesai", "batal"];
  return order.map((s) => ({ status: s, count: ORDERS.filter((o) => o.status === s).length }));
}
export function getActivities(limit = 8) {
  return ACTIVITIES.slice(0, limit);
}
export const onlineNow = ONLINE_NOW;
export const customerCount = CUSTOMER_COUNT;
