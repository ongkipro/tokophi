import "server-only";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { sql } from "drizzle-orm";
import { dayKey, dayOf, hourOf, today, midnightDaysAgo } from "@/lib/data/day-bucket";
import type { DayPoint } from "@/lib/mock/store";

// ---------------------------------------------------------------------------
// 🔴 `analytics_daily` IS RETIRED. THE SERIES IS DERIVED FROM `orders`, LIVE. (2026-08-03)
//
// What was wrong: `analytics_daily` had exactly ONE writer in the entire repository — the seed
// (`packages/db/src/seed.ts`). No cron, no order hook, nothing. So:
//   · the SIX demo stores that are not `batik-nusantara` had **zero rows**, and every money figure
//     on their Dashboard and all of /analitik read "Rp0 / belum ada data" while `orders` held real
//     sales (kopi-senja: 3 orders, Rp450rb, showing "Belum ada penjualan pada periode ini");
//   · on the seeded store the rows stopped on the day the seed ran, so on 2026-08-03 the page said
//     "Penjualan hari ini Rp0, −100,0%" and drew a chart labelled "30 Hari Terakhir" whose axis read
//     5 Jun → 2 Jul, immediately above "Pesanan Terbaru" listing four orders placed that morning.
//     ONE screen, contradicting itself, for every merchant in production.
//
// THE SHAPE CHOSEN: derive at read time. `getDailyStats()` is the ONLY reader the table ever had,
// so this is one function body, not a migration of many call sites — every downstream derivation in
// `lib/data/dashboard.ts` keeps its exact `DayPoint[]` contract.
//   · rejected — a CRON that materialises the rollup: faster on a huge store, but it is one more
//     thing that stops silently, and this repo has a documented history of exactly that (a red
//     `verify-rls` nobody read; a `check-pixel-defer` asserting against a 404 for its whole life).
//     A stopped cron reproduces the bug being fixed here, and looks identical to working software.
//   · rejected — a database VIEW named `analytics_daily`: same freshness, but it needs a destructive
//     migration to drop the table, and a view is `security_definer` by default so the RLS story
//     changes. The query below runs under `withCurrentTenant` → `SET LOCAL ROLE tokophi_app`, so it
//     is policed by the same policies as every other read here.
//   · rejected — pointing each screen at `orders` directly: the smallest diff on paper, but it
//     duplicates "what counts as revenue" across the chart, the KPIs, the money tiles and the
//     sparklines. There is one aggregate and one definition.
//
// COST, stated rather than assumed: one bounded aggregate per page load, `placed_at >= midnight
// 120 days ago`, served by `orders_store_placed_idx (store_id, placed_at)`. Measured on the shared
// dev DB (batik-nusantara, 885 orders): ~4 ms. A store with a million orders scans only its own
// last 120 days; if that ever hurts, the answer is a materialised view refreshed BY the write path,
// not a cron on a timer.
//
// WHAT HAPPENS TO THE SEEDED ROWS: nothing reads them any more, and the seed no longer writes them.
// Rows already in an existing database are inert — the table is kept (dropping it is a destructive
// migration) but it is no longer a source of truth that can disagree with `orders`. See the note on
// `analyticsDaily` in `packages/db/src/schema.ts`.
//
// `revenue` is `total_idr - tax_idr`, the SAME expression `getChannelSalesDaily`, `getRegionSales`
// and `getOrderStats` already use — so the chart's total now equals the Sumber Penjualan pie's
// total instead of contradicting it.
//
// `visitors` has no source in `orders` and was NOT invented: it is counted from `analytics_events`
// (`type = 'visit'`), the same rows `getVisitsKpi`/`getConversionKpi` count, with `count(*)` rather
// than `count(distinct session_id)` so the two can never disagree. A store the storefront tracker
// has never written for gets 0, and the UI renders "—" (it already did).
// ---------------------------------------------------------------------------

/** Days of history the series carries. `resolve()` needs 60 for "30d vs 30d" and ~92 for months. */
export const SERIES_DAYS = 120;

/**
 * Daily series for the Dashboard/Analitik chart + KPIs — DENSE and ending TODAY (merchant time).
 *
 * ⚠️ THE DENSITY IS LOAD-BEARING. `resolve()` in `lib/data/dashboard.ts` does `all.slice(n - 7, n)`
 * — it treats this array as one contiguous row per calendar day, ending today. A bare `GROUP BY`
 * would drop the days with no orders, so "7 hari terakhir" would quietly mean "the last 7 days that
 * happened to sell something", and `all[n-1]` ("Hari ini") would be the last day with a sale rather
 * than today. `generate_series` LEFT JOINed to the aggregates is what makes the range switcher mean
 * what it says.
 */
export async function getDailyStats(): Promise<DayPoint[]> {
  return withCurrentTenant(dailyStatsRows);
}

/**
 * The query itself, taking the tenant-scoped handle — so `daily-stats.test.ts` can run the REAL
 * SQL (under `SET LOCAL ROLE tokophi_app` + the `app.store_id` GUC, exactly as production does)
 * against a throwaway database. A test that re-types the SQL guards nothing; this is the only copy.
 */
export async function dailyStatsRows(db: Tx): Promise<DayPoint[]> {
  {
    const rows = (await db.execute(sql`
      with d as (
        select generate_series(${today()} - ${SERIES_DAYS}::int, ${today()}, interval '1 day')::date as day
      ),
      o as (
        select ${dayOf(sql`o.placed_at`)}               as day,
               sum(o.total_idr - o.tax_idr)::bigint     as sales,
               count(*)::int                            as orders
          from orders o
         where ${NOT_CANCELLED}
           and o.placed_at >= ${midnightDaysAgo(SERIES_DAYS)}
         group by 1
      ),
      v as (
        select ${dayOf(sql`e.ts`)} as day, count(*)::int as visitors
          from analytics_events e
         where e.type = 'visit'
           and e.ts >= ${midnightDaysAgo(SERIES_DAYS)}
         group by 1
      )
      select to_char(d.day, 'YYYY-MM-DD')  as "date",
             coalesce(o.sales, 0)::bigint  as "sales",
             coalesce(o.orders, 0)::int    as "orders",
             coalesce(v.visitors, 0)::int  as "visitors"
        from d
        left join o on o.day = d.day
        left join v on v.day = d.day
       order by d.day
    `)) as unknown as { date: string; sales: string | number; orders: number; visitors: number }[];

    return rows.map((r) => ({
      date: r.date,
      ts: Date.parse(r.date),
      sales: Number(r.sales),
      orders: Number(r.orders),
      visitors: Number(r.visitors),
    }));
  }
}

export type HourPoint = { date: string; hour: number; sales: number; orders: number };

/**
 * Intraday series for the "Hari ini" / "Kemarin" ranges — REAL hours off `orders.placed_at`.
 *
 * It replaces `hourlyFor()` from `lib/mock/store.ts`, which took a real daily total and splattered
 * it across 24 hours on a hard-coded weight curve plus seeded noise: a shape nobody measured,
 * rendered on a page whose own comment says "nothing on this page is synthesized" inside a file
 * whose header says "no storage access here".
 *
 * Three days deep because "Kemarin" compares yesterday against the day before it.
 */
export async function getHourlyStats(): Promise<HourPoint[]> {
  return withCurrentTenant(hourlyStatsRows);
}

/** The query itself — see `dailyStatsRows` for why it is separable. */
export async function hourlyStatsRows(db: Tx): Promise<HourPoint[]> {
  {
    const rows = (await db.execute(sql`
      select ${dayKey(sql`o.placed_at`)}                as "date",
             ${hourOf(sql`o.placed_at`)}                as "hour",
             sum(o.total_idr - o.tax_idr)::bigint       as "sales",
             count(*)::int                              as "orders"
        from orders o
       where ${NOT_CANCELLED}
         and o.placed_at >= ${midnightDaysAgo(2)}
       group by 1, 2
    `)) as unknown as { date: string; hour: number; sales: string | number; orders: number }[];
    return rows.map((r) => ({ date: r.date, hour: Number(r.hour), sales: Number(r.sales), orders: Number(r.orders) }));
  }
}

// ---------------------------------------------------------------------------
// Real analytics aggregates for /analitik. Every figure below is derived from
// the store's OWN rows (orders / order_line_items / products), RLS-scoped via
// withCurrentTenant → a store with no orders gets empty arrays / zeros, and the
// UI renders a "belum ada data" state rather than a fabricated number.
//
// NOT here (deliberately): ad/ROAS numbers ("Pemasaran" says "Belum terhubung" —
// there is no Meta/Google/TikTok integration). The conversion funnel + device
// split ARE live now: `analytics_events` (store_id, ts, type, session_id, device,
// RLS'd) is written by the storefront tracker (`apps/storefront/src/pages/api/track.ts`,
// since b7ae0ff) — see `lib/data/funnel.ts`, which COUNTS from it. This file stays
// order-derived; the event-derived cards live in funnel.ts.
// ---------------------------------------------------------------------------

// Cancelled orders are excluded from every revenue/customer aggregate.
const NOT_CANCELLED = sql`o.status <> 'batal'`;

export type RegionSale = { city: string; sales: number };

// Penjualan per wilayah. NOTE: `orders` has both `city` and `province`, but the
// checkout only ever fills `city` (province is NULL on 100% of rows today), so
// we aggregate by city. Switch the GROUP BY to province once it is populated.
export async function getRegionSales(limit = 6): Promise<RegionSale[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select coalesce(nullif(o.city, ''), 'Tidak diketahui') as "city",
             sum(o.total_idr - o.tax_idr)::bigint as "sales"
      from orders o
      where ${NOT_CANCELLED}
      group by 1
      order by "sales" desc
    `)) as unknown as { city: string; sales: string | number }[];

    const all = rows.map((r) => ({ city: r.city, sales: Number(r.sales) }));
    if (all.length <= limit + 1) return all;
    const head = all.slice(0, limit);
    const rest = all.slice(limit).reduce((a, r) => a + r.sales, 0);
    return rest > 0 ? [...head, { city: "Lainnya", sales: rest }] : head;
  });
}

export type CustomerMix = { baru: number; kembali: number };

// Pelanggan baru vs kembali: a customer with exactly one (non-cancelled) order is
// "baru"; one with an earlier order too is "kembali".
export async function getCustomerMix(): Promise<CustomerMix> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      with per_customer as (
        select o.customer_id, count(*) as orders
        from orders o
        where ${NOT_CANCELLED} and o.customer_id is not null
        group by 1
      )
      select count(*) filter (where orders = 1)::int as "baru",
             count(*) filter (where orders > 1)::int as "kembali"
      from per_customer
    `)) as unknown as { baru: number; kembali: number }[];
    return { baru: rows[0]?.baru ?? 0, kembali: rows[0]?.kembali ?? 0 };
  });
}

export type CategorySale = { category: string; revenue: number };

// Penjualan per kategori — from what was actually SOLD (order line items → variant
// → product.category), not from the product catalog's list price × units_sold.
export async function getCategorySales(): Promise<CategorySale[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select coalesce(nullif(p.category, ''), 'Tanpa kategori') as "category",
             sum(li.total_idr)::bigint as "revenue"
      from order_line_items li
      join orders o on o.id = li.order_id
      join product_variants v on v.id = li.variant_id
      join products p on p.id = v.product_id
      where ${NOT_CANCELLED}
      group by 1
      order by "revenue" desc
    `)) as unknown as { category: string; revenue: string | number }[];
    return rows.map((r) => ({ category: r.category, revenue: Number(r.revenue) }));
  });
}

export type ChannelDay = { date: string; channel: string; value: number };

const CHANNEL_LABEL: Record<string, string> = {
  meta_ads: "Meta Ads", google_ads: "Google Ads", tiktok_ads: "TikTok Ads",
  organic: "Organik", other: "Lainnya",
};

// Sumber penjualan — COUNTED from the `orders.channel` column that is stored per order, NOT
// from a fixed weight vector. Day-bucketed so the range switcher can filter it client-side.
export async function getChannelSalesDaily(): Promise<ChannelDay[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select ${dayKey(sql`o.placed_at`)}          as "date",
             o.channel::text                      as "channel",
             sum(o.total_idr - o.tax_idr)::bigint as "value"
      from orders o
      where ${NOT_CANCELLED}
      group by 1, 2
    `)) as unknown as { date: string; channel: string; value: string | number }[];
    return rows.map((r) => ({ date: r.date, channel: CHANNEL_LABEL[r.channel] ?? r.channel, value: Number(r.value) }));
  });
}

export type ProductSaleDay = {
  date: string; productId: string; name: string; emoji: string; image: string; revenue: number; units: number;
};

// Produk terlaris — real revenue/units from the line items that were actually sold
// (order_line_items → product_variants → products), day-bucketed for the range switcher.
// This replaces the old synthesis (period total × unitsSold × 1.9).
export async function getProductSalesDaily(): Promise<ProductSaleDay[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select ${dayKey(sql`o.placed_at`)}        as "date",
             p.id::text                         as "productId",
             p.title                            as "name",
             coalesce(p.emoji, '')              as "emoji",
             coalesce(m.url, '')                as "image",
             sum(li.total_idr)::bigint          as "revenue",
             sum(li.qty)::int                   as "units"
      from order_line_items li
      join orders o on o.id = li.order_id
      join product_variants v on v.id = li.variant_id
      join products p on p.id = v.product_id
      left join lateral (
        select pm.url from product_media pm where pm.product_id = p.id order by pm.position asc limit 1
      ) m on true
      where ${NOT_CANCELLED}
      group by 1, 2, 3, 4, 5
    `)) as unknown as { date: string; productId: string; name: string; emoji: string; image: string; revenue: string | number; units: number }[];
    return rows.map((r) => ({ ...r, revenue: Number(r.revenue), units: Number(r.units) }));
  });
}

export type OrderStats = { orders: number; revenue: number; items: number; aov: number; itemsPerOrder: number };

// All-time order totals straight from `orders` / `order_line_items` (non-cancelled).
export async function getOrderStats(): Promise<OrderStats> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = (await db.execute(sql`
      select count(*)::int as "orders",
             coalesce(sum(o.total_idr - o.tax_idr), 0)::bigint as "revenue",
             coalesce((
               select sum(li.qty)
               from order_line_items li
               join orders o2 on o2.id = li.order_id
               where o2.status <> 'batal'
             ), 0)::int as "items"
      from orders o
      where ${NOT_CANCELLED}
    `)) as unknown as { orders: number; revenue: string | number; items: number }[];

    const orders = rows[0]?.orders ?? 0;
    const items = rows[0]?.items ?? 0;
    const revenue = Number(rows[0]?.revenue ?? 0);
    return {
      orders,
      revenue,
      items,
      aov: orders ? Math.round(revenue / orders) : 0,
      itemsPerOrder: orders ? items / orders : 0,
    };
  });
}
