import "server-only";
import { db, schema } from "@indostore/db";
import { asc, eq } from "drizzle-orm";
import type { Discount } from "@/lib/mock/store";

// Admin display status is derived from the dates (real terjadwal / aktif / kadaluarsa).
const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");
const KIND_TO_TYPE = { persen: "persen", nominal: "nominal", gratis_ongkir: "ongkir" } as const;

function toDiscount(r: {
  id: string; code: string; kind: "persen" | "nominal" | "gratis_ongkir"; value: number;
  usedCount: number; usageLimit: number | null; startsAt: Date | null; endsAt: Date | null;
}): Discount {
  const now = ADMIN_TODAY.getTime();
  const starts = r.startsAt ? r.startsAt.getTime() : now;
  const ends = r.endsAt ? r.endsAt.getTime() : now;
  const status: Discount["status"] = now < starts ? "terjadwal" : now > ends ? "kadaluarsa" : "aktif";
  return {
    id: r.id,
    code: r.code,
    type: KIND_TO_TYPE[r.kind],
    value: r.value,
    status,
    used: r.usedCount,
    limit: r.usageLimit ?? 0,
    endsInDays: Math.round((ends - now) / 86_400_000),
  };
}

export async function getDiscounts(): Promise<Discount[]> {
  const rows = await db.select().from(schema.discounts).orderBy(asc(schema.discounts.code));
  return rows.map(toDiscount);
}

export async function getDiscount(id: string): Promise<Discount | null> {
  const rows = await db.select().from(schema.discounts).where(eq(schema.discounts.id, id)).limit(1);
  return rows[0] ? toDiscount(rows[0]) : null;
}
