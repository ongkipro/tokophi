import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant } from "@/lib/tenant";
import { asc, eq } from "drizzle-orm";
import type { Discount } from "@/lib/mock/store";

// Admin display status is derived from the dates (real terjadwal / aktif / kadaluarsa).
const KIND_TO_TYPE = { persen: "persen", nominal: "nominal", gratis_ongkir: "ongkir" } as const;

function toDiscount(r: {
  id: string; code: string; kind: "persen" | "nominal" | "gratis_ongkir"; value: number;
  usedCount: number; usageLimit: number | null; startsAt: Date | null; endsAt: Date | null;
  status: "aktif" | "terjadwal" | "nonaktif";
}): Discount {
  // ⚠️ Read the real clock. This was frozen to the seed's TODAY, so an expired voucher still showed
  // "Aktif" — and `endsInDays` seeds the editor's period field, which the save path then re-anchored,
  // writing the lie back to the DB. A no-end-date voucher (ends_at NULL) never expires.
  const now = Date.now();
  const starts = r.startsAt ? r.startsAt.getTime() : now;
  const ends = r.endsAt ? r.endsAt.getTime() : null;
  // `nonaktif` wins over any date arithmetic — it is the merchant's explicit OFF, and deriving a
  // status purely from the dates is what let the editor resurrect a switched-off voucher.
  const status: Discount["status"] =
    r.status === "nonaktif"
      ? "nonaktif"
      : now < starts
        ? "terjadwal"
        : ends !== null && now > ends
          ? "kadaluarsa"
          : "aktif";
  return {
    id: r.id,
    code: r.code,
    type: KIND_TO_TYPE[r.kind],
    value: r.value,
    status,
    used: r.usedCount,
    limit: r.usageLimit ?? 0,
    // null, never 0: `endsLabel(0)` renders "Berakhir hari ini" and the editor seeds its period field
    // with it, so a voucher with no end date would both READ as expiring today and be re-saved as one.
    endsInDays: ends === null ? null : Math.round((ends - now) / 86_400_000),
  };
}

export async function getDiscounts(): Promise<Discount[]> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.discounts).orderBy(asc(schema.discounts.code));
    return rows.map(toDiscount);
  });
}

export async function getDiscount(id: string): Promise<Discount | null> {
  return withCurrentTenant(async (db) => {
    const rows = await db.select().from(schema.discounts).where(eq(schema.discounts.id, id)).limit(1);
    return rows[0] ? toDiscount(rows[0]) : null;
  });
}
