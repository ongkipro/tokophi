// Pure derivation utils for Dashboard/Analitik. The data (daily series, products, orders,
// activities) is fetched from the DB in the server wrapper and passed in — no storage access
// here, so these stay callable client-side (the range switcher re-derives on the client).
import type { DayPoint, Product, Order, Activity, Review } from "@/lib/types/domain";
import type { FunnelDay, DeviceDay } from "@/lib/data/funnel";
import type { ChannelDay, HourPoint, ProductSaleDay } from "@/lib/data/analytics";
import type { CourierReturns, ReturnsByCourier } from "@/lib/data/returns";
import type { TicketRow } from "@/lib/data/support";

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

/** `"2026-08" + (-1)` → `"2026-07"`. Pure string/int arithmetic — no Date, no timezone. */
export function shiftMonth(ym: string, by: number): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return "";
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + by;
  return `${String(Math.floor(t / 12)).padStart(4, "0")}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function resolve(all: DayPoint[], key: RangeKey): Resolved {
  const n = all.length;
  const slice = (a: number, b: number) => all.slice(Math.max(0, a), b);
  // ⚠️ THE MONTH COMES FROM THE DATA, NEVER FROM A LITERAL. This was
  //     case "month": all.filter(d => d.date.startsWith("2026-06"))   // "Bulan Lalu" = "2026-05"
  // — the seed's frame, frozen. Verified in a browser on 3 August 2026: choosing "Bulan Ini"
  // showed JUNE, and it drove all five KPIs, the chart and six derived cards on `/` and `/analitik`.
  // `getDailyStats()` returns a dense series ending on the server's today, so the last row's month
  // IS this month — and because it is a value that arrived as a prop, SSR and the client agree
  // (a `new Date()` here would be the hydration mismatch this repo's conventions forbid).
  // An empty series yields an empty month, not EVERY date (`"".startsWith` matches all).
  const thisMonth = all[n - 1]?.date.slice(0, 7) ?? "";
  const inMonth = (ym: string) => (ym ? all.filter((d) => d.date.startsWith(ym)) : []);
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
      return { days: inMonth(thisMonth), prev: inMonth(shiftMonth(thisMonth, -1)), granularity: "day", compardeLabel: "bulan lalu" };
    case "lastmonth":
      return { days: inMonth(shiftMonth(thisMonth, -1)), prev: inMonth(shiftMonth(thisMonth, -2)), granularity: "day", compardeLabel: "bulan sebelumnya" };
  }
}

const sum = (arr: DayPoint[], k: keyof Pick<DayPoint, "sales" | "orders" | "visitors">) =>
  arr.reduce((a, d) => a + d[k], 0);

/**
 * Percentage change vs the previous period — or `null` when there is NOTHING TO COMPARE TO.
 *
 * ⚠️ `null` and `0` are different facts and the screen must not say the same thing for both.
 * This returned `0` for an empty denominator, so a store with no history rendered
 * "Penjualan hari ini **+0,0%**" — which reads as *"no change"*, i.e. a measurement, on a store
 * that has never sold anything. Same family as the dashboard that printed
 * "Penjualan hari ini Rp0 · −100,0%" above four orders placed that morning: a figure with no
 * source is "—", never a number (see CLAUDE.md → "Dashboard & Analitik numbers").
 *
 * ⚠️ THE BOUNDARY IS THE DENOMINATOR, NOT THE NUMERATOR. A store that genuinely sold Rp0 today
 * after selling yesterday has a REAL −100%, and that must stay a number — turning a measured
 * collapse into an em dash is the same lie in the other direction. Only `prev === 0` is the dash,
 * because a change *from zero* has no percentage: it is not "+∞%" and it is certainly not "0%".
 * Pinned on both sides by `kpi-delta.test.ts`.
 */
const delta = (cur: number, prev: number): number | null =>
  prev === 0 ? null : ((cur - prev) / prev) * 100;

export type Kpi = { value: number; delta: number | null };
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

/**
 * @param hours real intraday rows (`getHourlyStats()`), used by the "Hari ini"/"Kemarin" ranges.
 *
 * ⚠️ THE INTRADAY CHART IS NOT SYNTHESIZED ANY MORE. It used to call `hourlyFor(days[0])` from
 * `lib/mock/store.ts`, which took the day's real total and spread it over 24 hours on a hard-coded
 * weight curve plus seeded jitter — a shape nobody had measured, drawn on a page whose comment says
 * "nothing on this page is synthesized" from a file whose header says "no storage access here".
 * `hours` comes from `orders.placed_at`; the 24 buckets sum to exactly the day's own total because
 * both aggregate the same rows with the same revenue expression and the same time zone.
 * With no rows the bars are ZERO, which is the truth, not a curve.
 */
export function getSeries(all: DayPoint[], key: RangeKey, hours: HourPoint[] = []): { points: SeriesPoint[]; granularity: "hour" | "day" } {
  const { days, prev, granularity } = resolve(all, key);
  if (granularity === "hour") {
    const bucket = (date: string | undefined) => {
      const out = Array.from({ length: 24 }, () => ({ sales: 0, orders: 0 }));
      if (!date) return out;
      for (const h of hours) {
        if (h.date !== date || h.hour < 0 || h.hour > 23) continue;
        out[h.hour].sales += h.sales;
        out[h.hour].orders += h.orders;
      }
      return out;
    };
    const cur = bucket(days[0]?.date);
    const pv = bucket(prev[0]?.date);
    return {
      granularity,
      points: cur.map((h, i) => ({ label: `${String(i).padStart(2, "0")}:00`, sales: h.sales, prev: pv[i].sales, orders: h.orders })),
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
  // `retur` included (migration 0039) — a returned order shipped and came back; it must not hide
  // inside "batal", which never left the warehouse.
  const order: Order["status"][] = ["baru", "diproses", "dikirim", "selesai", "retur", "batal"];
  return order.map((s) => ({ status: s, count: orders.filter((o) => o.status === s).length }));
}
export function getActivities(activities: Activity[], limit = 8) {
  return activities.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Event-derived cards (analytics_events, via lib/data/funnel.ts). Everything below is a
// COUNT of rows for the days inside the selected range — so the range switcher actually
// moves the numbers, and the funnel's top/bottom equal the Pengunjung/Pesanan KPIs
// (`getDailyStats().visitors` counts the very same `visit` rows, so the funnel's top step and
// the Pengunjung KPI cannot drift apart).
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

// ---------------------------------------------------------------------------
// Seller-centre layer: the action queue, the money strip, the return rate.
//
// An Indonesian seller opens the dashboard to answer ONE question — "what do I have to do right
// now, and is money stuck anywhere?" — so these three blocks lead the page and the vanity KPIs
// follow. Everything below is a PURE derivation over rows the server already fetched (orders /
// products / reviews / support_tickets / getReturnsByCourier), so every number on the dashboard
// traces back to an existing RLS-scoped query. Nothing here invents a figure, and a count of ZERO
// renders as a calm "beres" state rather than a made-up number.
// ---------------------------------------------------------------------------

/** Same threshold as /produk/inventori's "Menipis" tab, so the two screens can never disagree. */
export const LOW_STOCK = 20;

export type QueueTone = "urgent" | "warn" | "info";
export type QueueItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  /** Extra context, shown only when count > 0. */
  hint?: string;
  /** Shown when count === 0. */
  done: string;
  tone: QueueTone;
};

/**
 * "Antrian Kerja" — every row is a thing the seller can clear, with the screen that clears it.
 *
 * NOTE on reviews: the queue says "Ulasan perlu ditinjau" (reviews.status = 'menunggu'), NOT
 * "ulasan belum dibalas". There is no reply column on `reviews` and no replies table, so a
 * "belum dibalas" count would be fiction. Moderation is the real, gated action today.
 */
export function getActionQueue(
  orders: Order[],
  products: Product[],
  reviews: Review[],
  tickets: TicketRow[],
): QueueItem[] {
  const count = (s: Order["status"]) => orders.filter((o) => o.status === s).length;
  const active = products.filter((p) => p.status === "active");
  const out = active.filter((p) => p.stock === 0).length;
  const low = active.filter((p) => p.stock > 0 && p.stock < LOW_STOCK).length;
  const pendingReviews = reviews.filter((r) => r.status === "menunggu").length;
  const openTickets = tickets.filter((t) => t.status === "open").length;

  return [
    {
      key: "dikirim",
      label: "Perlu dikirim",
      count: count("diproses"),
      href: "/pesanan",
      hint: "pesanan siap diproses",
      done: "Tidak ada yang menunggu dikirim",
      tone: "urgent",
    },
    {
      key: "baru",
      label: "Pesanan baru",
      count: count("baru"),
      href: "/pesanan",
      hint: "belum dikonfirmasi",
      done: "Semua pesanan sudah dikonfirmasi",
      tone: "urgent",
    },
    {
      key: "stok",
      label: "Stok menipis",
      count: low + out,
      href: "/produk/inventori",
      hint: out ? `${out} produk habis` : `sisa < ${LOW_STOCK} unit`,
      done: "Stok semua produk aman",
      tone: out ? "urgent" : "warn",
    },
    {
      key: "ulasan",
      label: "Ulasan perlu ditinjau",
      count: pendingReviews,
      href: "/pelanggan/ulasan",
      hint: "menunggu moderasi",
      done: "Semua ulasan sudah ditinjau",
      tone: "warn",
    },
    {
      key: "tiket",
      label: "Tiket bantuan",
      count: openTickets,
      href: "/bantuan",
      hint: "masih terbuka",
      done: "Tidak ada tiket terbuka",
      tone: "info",
    },
  ];
}

export type StuckMoney = { orders: number; value: number };

/** "Uang tertahan": the rupiah sitting in orders the seller has not shipped yet (baru + diproses). */
export function getStuckMoney(orders: Order[]): StuckMoney {
  const open = orders.filter((o) => o.status === "baru" || o.status === "diproses");
  return { orders: open.length, value: open.reduce((a, o) => a + o.total, 0) };
}

export type MoneyTile = { key: RangeKey; label: string; value: number; delta: number | null; compareLabel: string; spark: number[] };

/**
 * "Uang masuk" — penjualan hari ini / 7 hari / 30 hari, each vs the SAME-LENGTH previous period.
 * Fixed ranges on purpose (a seller centre always shows all three at once); they do NOT follow the
 * range switcher, which drives the chart below. Built on `resolve()`/`getSummary()` — no new maths.
 *
 * ⚠️ SOURCE = `getDailyStats()`, which is now DERIVED FROM `orders` (non-cancelled,
 * `total_idr - tax_idr`, bucketed in WIB). So these tiles, the chart, /analitik and "Uang tertahan"
 * below are all projections of the same rows a merchant can open in Pesanan.
 *
 * The paragraph that used to sit here said the rollup and `orders` disagreed but "do not visibly
 * clash". That conclusion was FALSE, and it was the reassurance that let the bug live: on
 * 2026-08-03 this strip read "Penjualan hari ini Rp0 · −100,0% vs kemarin" directly above a
 * "Pesanan Terbaru" list showing four orders placed that morning (Rp1.571.028) — one screen,
 * two answers, in adjacent cards. It clashed because `analytics_daily` had no writer outside the
 * seed. It is retired; see the header of `lib/data/analytics.ts`.
 *
 * "Uang tertahan" still answers a different QUESTION (rupiah in unshipped orders, `baru` +
 * `diproses`, regardless of date) — so still do not add it to a sales tile. But both now count the
 * same table, so a discrepancy is now a real discrepancy and not two universes.
 */
export function getMoneyTiles(all: DayPoint[]): MoneyTile[] {
  const tiles: { key: RangeKey; label: string }[] = [
    { key: "today", label: "Penjualan hari ini" },
    { key: "7d", label: "Penjualan 7 hari" },
    { key: "30d", label: "Penjualan 30 hari" },
  ];
  return tiles.map(({ key, label }) => {
    const s = getSummary(all, key);
    const { days } = resolve(all, key);
    return {
      key,
      label,
      value: s.sales.value,
      delta: s.sales.delta,
      compareLabel: s.compareLabel,
      // "today" is a single day → give the sparkline the last 14 days for shape.
      spark: (days.length > 1 ? days : all.slice(-14)).map((d) => d.sales),
    };
  });
}

export type ReturnSummary = {
  shipped: number;
  returned: number;
  rate: number; // 0..1
  codShipped: number;
  codReturned: number;
  codRate: number;
  nonCodShipped: number;
  nonCodReturned: number;
  nonCodRate: number;
  byCourier: CourierReturns[];
  /** Shipped orders with no courier — in none of the rates above; the card names the count. */
  unattributed: number;
};

/**
 * Tingkat retur — the single most expensive thing that can happen to an Indonesian seller running
 * COD. Rolls up `getReturnsByCourier()` (orders.status = 'retur', migration 0039). Denominator =
 * orders that actually SHIPPED (dikirim | selesai | retur); an order still in `baru`/`diproses`
 * never had the chance to be refused and counting it would flatter the rate.
 */
export function getReturnSummary({ byCourier: rows, unattributed }: ReturnsByCourier): ReturnSummary {
  const add = (k: keyof CourierReturns) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const shipped = add("shipped");
  const returned = add("returned");
  const codShipped = add("codShipped");
  const codReturned = add("codReturned");
  const nonCodShipped = shipped - codShipped;
  const nonCodReturned = returned - codReturned;
  return {
    shipped,
    returned,
    rate: shipped ? returned / shipped : 0,
    codShipped,
    codReturned,
    codRate: codShipped ? codReturned / codShipped : 0,
    nonCodShipped,
    nonCodReturned,
    nonCodRate: nonCodShipped ? nonCodReturned / nonCodShipped : 0,
    byCourier: [...rows].sort((a, b) => b.returned - a.returned || b.shipped - a.shipped),
    unattributed,
  };
}

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
