import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { eq, sql, type SQL } from "drizzle-orm";
import type { Order } from "@/lib/mock/store";

const TODAY = new Date("2026-07-02T00:00:00Z");
const CHANNEL_DISPLAY: Record<string, string> = {
  meta_ads: "Meta Ads", tiktok_ads: "TikTok Ads", google_ads: "Google Ads", organic: "Organic", other: "Other",
};

const sel = {
  number: schema.orders.number,
  customer: schema.customers.name,
  city: schema.orders.city,
  total: schema.orders.totalIdr,
  status: schema.orders.status,
  channel: schema.orders.channel,
  placedAt: schema.orders.placedAt,
  awb: schema.orders.awb,
  courier: schema.orders.courier,
  items: sql<number>`count(${schema.orderLineItems.id})`.mapWith(Number),
};

// `where` is applied BEFORE groupBy (chaining .where() after .groupBy() lands as HAVING → 0 rows).
function q(db: Tx, where?: SQL) {
  const base = db
    .select(sel)
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .leftJoin(schema.orderLineItems, eq(schema.orderLineItems.orderId, schema.orders.id));
  return (where ? base.where(where) : base).groupBy(schema.orders.id, schema.customers.name);
}

function toOrder(r: {
  number: string; customer: string | null; city: string | null; total: number;
  status: "baru" | "diproses" | "dikirim" | "selesai" | "batal"; channel: string; placedAt: Date; items: number;
  awb?: string | null; courier?: string | null;
}): Order {
  return {
    id: "#" + r.number,
    customer: r.customer ?? "—",
    city: r.city ?? "",
    total: r.total,
    items: r.items,
    status: r.status,
    channel: CHANNEL_DISPLAY[r.channel] ?? r.channel,
    minutesAgo: Math.round((TODAY.getTime() - r.placedAt.getTime()) / 60_000),
    awb: r.awb ?? null,
    courierName: r.courier ?? null,
  };
}

export async function getOrders(): Promise<Order[]> {
  return withCurrentTenant(async (db) => {
    const rows = await q(db);
    return rows.map(toOrder).sort((a, b) => a.minutesAgo - b.minutesAgo);
  });
}

export async function getOrder(number: string): Promise<Order | null> {
  return withCurrentTenant(async (db) => {
    const rows = await q(db, eq(schema.orders.number, number)).limit(1);
    return rows[0] ? toOrder(rows[0]) : null;
  });
}
