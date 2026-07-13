import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { desc, eq, sql } from "drizzle-orm";
import type { Customer, Order } from "@/lib/mock/store";

const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");
// Same anchor as `lib/data/orders.ts` so relative times match the Pesanan screens.
const ORDERS_TODAY = new Date("2026-07-02T00:00:00Z");

function toCustomer(r: {
  id: string; name: string; email: string | null; phone: string | null; city: string | null;
  ordersCount: number; totalSpentIdr: number; segment: "baru" | "reguler" | "loyal" | "vip"; createdAt: Date;
  tags?: unknown; notes?: string | null;
}): Customer {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? "",
    phone: r.phone ?? "",
    city: r.city ?? "",
    orders: r.ordersCount,
    spent: r.totalSpentIdr,
    segment: r.segment,
    joinedDaysAgo: Math.round((ADMIN_TODAY.getTime() - r.createdAt.getTime()) / 86_400_000),
    tags: (r.tags as string[] | null) ?? undefined,
    notes: r.notes ?? undefined,
  };
}

export async function getCustomers(): Promise<Customer[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.customers).orderBy(desc(schema.customers.totalSpentIdr));
    return rows.map(toCustomer);
  });
}

export async function getCustomer(id: string): Promise<Customer | null> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.customers).where(eq(schema.customers.id, id)).limit(1);
    return rows[0] ? toCustomer(rows[0]) : null;
  });
}

// One row of a customer's order history (subset of the flat `Order` shape used everywhere else).
export type CustomerOrder = Pick<
  Order,
  "id" | "city" | "total" | "items" | "status" | "channel" | "minutesAgo" | "awb" | "courierName"
>;

// Real order history for ONE customer — matched on `orders.customer_id` (never on name).
// Newest first.
export async function getCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select({
        number: schema.orders.number,
        city: schema.orders.city,
        total: schema.orders.totalIdr,
        status: schema.orders.status,
        channel: schema.orders.channel,
        placedAt: schema.orders.placedAt,
        awb: schema.orders.awb,
        courier: schema.orders.courier,
        items: sql<number>`count(${schema.orderLineItems.id})`.mapWith(Number),
      })
      .from(schema.orders)
      .leftJoin(schema.orderLineItems, eq(schema.orderLineItems.orderId, schema.orders.id))
      .where(eq(schema.orders.customerId, customerId))
      .groupBy(schema.orders.id);

    return rows
      .map((r): CustomerOrder => ({
        id: "#" + r.number,
        city: r.city ?? "",
        total: r.total,
        items: r.items,
        status: r.status,
        channel: r.channel,
        minutesAgo: Math.round((ORDERS_TODAY.getTime() - r.placedAt.getTime()) / 60_000),
        awb: r.awb,
        courierName: r.courier,
      }))
      .sort((a, b) => a.minutesAgo - b.minutesAgo);
  });
}
