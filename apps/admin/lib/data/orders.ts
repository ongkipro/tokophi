import "server-only";
import { db, schema } from "@indostore/db";
import { eq, sql } from "drizzle-orm";
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
  items: sql<number>`count(${schema.orderLineItems.id})`.mapWith(Number),
};

function q() {
  return db
    .select(sel)
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .leftJoin(schema.orderLineItems, eq(schema.orderLineItems.orderId, schema.orders.id))
    .groupBy(schema.orders.id, schema.customers.name);
}

function toOrder(r: {
  number: string; customer: string | null; city: string | null; total: number;
  status: "baru" | "diproses" | "dikirim" | "selesai" | "batal"; channel: string; placedAt: Date; items: number;
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
  };
}

export async function getOrders(): Promise<Order[]> {
  const rows = await q();
  return rows.map(toOrder).sort((a, b) => a.minutesAgo - b.minutesAgo);
}

export async function getOrder(number: string): Promise<Order | null> {
  const rows = await q().where(eq(schema.orders.number, number)).limit(1);
  return rows[0] ? toOrder(rows[0]) : null;
}
