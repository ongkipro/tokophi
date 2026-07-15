import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { asc, sql } from "drizzle-orm";
import type { DayPoint } from "@/lib/mock/store";

// Daily sales rollup for the Dashboard/Analitik series (120 days, oldest→newest).
export async function getDailyStats(): Promise<DayPoint[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.analyticsDaily).orderBy(asc(schema.analyticsDaily.date));
    return rows.map((r) => ({ date: r.date, ts: Date.parse(r.date), sales: r.salesIdr, orders: r.orders, visitors: r.visitors }));
  });
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
             sum(o.total_idr)::bigint as "sales"
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
      select to_char(o.placed_at, 'YYYY-MM-DD') as "date",
             o.channel::text                    as "channel",
             sum(o.total_idr)::bigint           as "value"
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
      select to_char(o.placed_at, 'YYYY-MM-DD') as "date",
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
             coalesce(sum(o.total_idr), 0)::bigint as "revenue",
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
