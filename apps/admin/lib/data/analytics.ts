import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { asc } from "drizzle-orm";
import type { DayPoint } from "@/lib/mock/store";

// Daily sales rollup for the Dashboard/Analitik series (120 days, oldest→newest).
export async function getDailyStats(): Promise<DayPoint[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.analyticsDaily).orderBy(asc(schema.analyticsDaily.date));
    return rows.map((r) => ({ date: r.date, ts: Date.parse(r.date), sales: r.salesIdr, orders: r.orders, visitors: r.visitors }));
  });
}
