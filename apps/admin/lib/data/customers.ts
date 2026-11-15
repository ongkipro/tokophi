import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { buyerAccountEnabled } from "@tokophi/lib/claim-token";
import { and, desc, eq, getTableColumns, max, min, countDistinct, sql } from "drizzle-orm";
import type { Customer, Order } from "@/lib/types/domain";

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
  /** Connected to a TokoΦ Account (ADR 0016) through at least one saved order of THIS store. */
  accountLinked: boolean;
  lastOrderMinutesAgo: number | null;
};

function toCustomer(r: {
  id: string; name: string; email: string | null; phone: string | null; city: string | null;
  ordersCount: number; totalSpentIdr: number; segment: "baru" | "reguler" | "loyal" | "vip"; createdAt: Date;
  tags?: unknown; notes?: string | null; registeredAt?: Date | null; lastOrderAt?: Date | null;
  accountLinkedAt?: Date | null;
}): CustomerRow {
  // "Terdaftar" = the person can sign in and see their orders here. Since ADR 0016 the real source of
  // that fact is a TokoΦ Account link; `registered_at` is the older column nothing in the app writes
  // (production holds 0 rows with it set — measured 2026-11-14), kept so seeded data still reads.
  // Dormant while the TokoΦ Account feature is OFF (ADR 0016): no badge, no "connected since".
  const linkedAt = buyerAccountEnabled() ? (r.accountLinkedAt ?? null) : null;
  const since = linkedAt ?? r.registeredAt ?? null;
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
    registered: since != null,
    registeredDaysAgo: since ? Math.round((Date.now() - since.getTime()) / 86_400_000) : null,
    accountLinked: linkedAt != null,
    lastOrderMinutesAgo: r.lastOrderAt
      ? Math.max(0, Math.round((Date.now() - r.lastOrderAt.getTime()) / 60_000))
      : null,
  };
}

// ── TokoΦ Account, the merchant projection (ADR 0016) ─────────────────────────────────────────────
// A customer is "connected" when at least one of their orders in THIS store was saved to an account
// whose link to this store is still ACTIVE (the buyer can unlink; then the store sees a guest again).
// The Seller learns THAT and SINCE WHEN — never who the account is: `buyer_accounts` has no RLS policy,
// so even a deliberate join would return nothing under `tokophi_app`, and `buyer_id` never leaves here.
// Both tables are tenant-scoped (RLS); the explicit `store_id` predicates are the rule, RLS the net.
// Column names are written out, never interpolated: inside a template with its own FROM, drizzle
// renders `${schema.customers.id}` unqualified and the inner scope would capture it
// (packages/db/src/correlated-subquery-scoping.test.ts).
const accountLinkedAt = sql<Date | null>`(select min(l.created_at) from buyer_order_claims c
    join orders o on o.id = c.order_id and o.store_id = c.store_id
    join buyer_store_links l on l.buyer_id = c.buyer_id and l.store_id = c.store_id and l.status = 'active'
   where o.customer_id = "customers"."id" and c.store_id = "customers"."store_id")`.mapWith((v) => (v ? new Date(v) : null));

/** Exported for the RLS test (customers-account.test.ts), which runs the same columns as tokophi_app. */
export const customerCols = { ...getTableColumns(schema.customers), accountLinkedAt };

export async function getCustomers(
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<CustomerRow[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db
      .select(customerCols)
      .from(schema.customers)
      .orderBy(desc(schema.customers.totalSpentIdr))
      .limit(limit)
      .offset(offset);
    return rows.map(toCustomer);
  });
}

export async function getCustomer(id: string): Promise<CustomerRow | null> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select(customerCols).from(schema.customers).where(eq(schema.customers.id, id)).limit(1);
    return rows[0] ? toCustomer(rows[0]) : null;
  });
}

// One row of a customer's order history (subset of the flat `Order` shape used everywhere else).
export type CustomerOrder = Pick<
  Order,
  "id" | "city" | "total" | "items" | "status" | "channel" | "minutesAgo" | "awb" | "courierName"
> & {
  /** The buyer saved this order to their TokoΦ Account and the link to this store is active (ADR 0016). */
  savedToAccount: boolean;
};

// Real order history for ONE customer — matched on `orders.customer_id` (never on name).
// Newest first.
export async function getCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
  return withCurrentTenant((db) => customerOrderRows(db, customerId));
}

/** The query behind `getCustomerOrders`, on a tenant transaction (exported for the RLS test). */
export async function customerOrderRows(db: Tx, customerId: string): Promise<CustomerOrder[]> {
  const enabled = buyerAccountEnabled(); // ADR 0016: no "Tersimpan di Akun TokoΦ" marker while OFF
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
      savedToAccount: sql<boolean>`exists (select 1 from buyer_order_claims c
          join buyer_store_links l on l.buyer_id = c.buyer_id and l.store_id = c.store_id and l.status = 'active'
         where c.order_id = "orders"."id" and c.store_id = "orders"."store_id")`,
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
      savedToAccount: enabled && r.savedToAccount === true,
    }))
    .sort((a, b) => a.minutesAgo - b.minutesAgo);
}

// ── Pelanggan → Akun Pembeli (ADR 0016) ───────────────────────────────────────────────────────────
// THIS store's customers who saved at least one order to a TokoΦ Account, with how many of this store's
// orders they saved and since when the link exists. Nothing about the account itself (email, name,
// other stores, devices) is selected — that is the merchant projection ADR 0016 allows.
export type AccountCustomer = {
  id: string;
  name: string;
  phone: string;
  city: string;
  savedOrders: number;
  linkedDaysAgo: number;
  lastSavedMinutesAgo: number;
};

export async function getAccountCustomers(): Promise<AccountCustomer[]> {
  return withCurrentTenant(accountCustomerRows);
}

/** The query behind `getAccountCustomers`, on a tenant transaction (exported for the RLS test). */
export async function accountCustomerRows(db: Tx, storeId: string): Promise<AccountCustomer[]> {
  const c = schema.buyerOrderClaims;
  const l = schema.buyerStoreLinks;
  const o = schema.orders;
  const cu = schema.customers;
  const rows = await db
    .select({
      id: cu.id,
      name: cu.name,
      phone: cu.phone,
      city: cu.city,
      savedOrders: countDistinct(c.orderId),
      linkedAt: min(l.createdAt),
      lastSavedAt: max(c.claimedAt),
    })
    .from(c)
    .innerJoin(o, and(eq(o.id, c.orderId), eq(o.storeId, c.storeId)))
    .innerJoin(l, and(eq(l.buyerId, c.buyerId), eq(l.storeId, c.storeId), eq(l.status, "active")))
    .innerJoin(cu, and(eq(cu.id, o.customerId), eq(cu.storeId, o.storeId)))
    .where(eq(c.storeId, storeId))
    .groupBy(cu.id)
    .orderBy(desc(max(c.claimedAt)));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? "",
    city: r.city ?? "",
    savedOrders: Number(r.savedOrders),
    linkedDaysAgo: r.linkedAt ? Math.max(0, Math.round((now - new Date(r.linkedAt).getTime()) / 86_400_000)) : 0,
    lastSavedMinutesAgo: r.lastSavedAt ? Math.max(0, Math.round((now - new Date(r.lastSavedAt).getTime()) / 60_000)) : 0,
  }));
}
