import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { desc, eq, sql } from "drizzle-orm";
import type { Customer, Order } from "@/lib/mock/store";

// ⚠️ THE REAL CLOCK, in both places below. These were frozen to the seed's frames (`2026-06-30` for
// the customer, `2026-07-02` to "match the Pesanan screens"), so the detail page rendered "Pelanggan
// sejak −32 hari lalu" — a negative age — for anyone who signed up after the seed was written, and
// every real order read "baru saja" forever. `lib/data/orders.ts` is on the real clock too, so the
// two screens still agree. The seed may be anchored; the app is not.

// A customer, plus the one fact the flat mock shape never carried: does this person have an ACCOUNT?
//
//   registered_at IS NULL  →  Tamu (guest)
//
// Guest is the NORMAL case, not a defect. Indonesian checkout never asks for a registration, and it
// must not — a signup wall in front of the payment step is the most reliable way to lose the sale.
// The screen presents "Tamu" as the ordinary state, and "Terdaftar" as the extra.
export type CustomerRow = Customer & {
  registered: boolean;
  registeredDaysAgo: number | null;
  lastOrderMinutesAgo: number | null;
};

function toCustomer(r: {
  id: string; name: string; email: string | null; phone: string | null; city: string | null;
  ordersCount: number; totalSpentIdr: number; segment: "baru" | "reguler" | "loyal" | "vip"; createdAt: Date;
  tags?: unknown; notes?: string | null; registeredAt?: Date | null; lastOrderAt?: Date | null;
}): CustomerRow {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? "",
    phone: r.phone ?? "",
    city: r.city ?? "",
    orders: r.ordersCount,
    spent: r.totalSpentIdr,
    segment: r.segment,
    joinedDaysAgo: Math.round((Date.now() - r.createdAt.getTime()) / 86_400_000),
    tags: (r.tags as string[] | null) ?? undefined,
    notes: r.notes ?? undefined,
    registered: r.registeredAt != null,
    registeredDaysAgo: r.registeredAt
      ? Math.round((Date.now() - r.registeredAt.getTime()) / 86_400_000)
      : null,
    lastOrderMinutesAgo: r.lastOrderAt
      ? Math.max(0, Math.round((Date.now() - r.lastOrderAt.getTime()) / 60_000))
      : null,
  };
}

export async function getCustomers(): Promise<CustomerRow[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.customers).orderBy(desc(schema.customers.totalSpentIdr));
    return rows.map(toCustomer);
  });
}

export async function getCustomer(id: string): Promise<CustomerRow | null> {
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
        minutesAgo: Math.round((Date.now() - r.placedAt.getTime()) / 60_000),
        awb: r.awb,
        courierName: r.courier,
      }))
      .sort((a, b) => a.minutesAgo - b.minutesAgo);
  });
}
