import "server-only";
import { schema } from "@indostore/db";
import { withCurrentTenant } from "@/lib/tenant";
import { desc, eq } from "drizzle-orm";
import type { Customer } from "@/lib/mock/store";

const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");

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
