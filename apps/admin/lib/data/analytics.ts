import "server-only";
import { db, schema } from "@indostore/db";
import { asc } from "drizzle-orm";
import type { DayPoint } from "@/lib/mock/store";

// Daily sales rollup for the Dashboard/Analitik series (120 days, oldest→newest).
export async function getDailyStats(): Promise<DayPoint[]> {
  const rows = await db.select().from(schema.analyticsDaily).orderBy(asc(schema.analyticsDaily.date));
  return rows.map((r) => ({ date: r.date, ts: Date.parse(r.date), sales: r.salesIdr, orders: r.orders, visitors: r.visitors }));
}
