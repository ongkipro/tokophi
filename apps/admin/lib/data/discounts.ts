import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Discount } from "@/lib/types/domain";

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
  // `habis` before any date arithmetic: `applyDiscount` refuses at the limit and `activeVouchers`
  // hides it, so a seller list badging it green "Aktif" was the FOURTH definition of "usable" for one
  // row (list / /promo / checkout / here). RAMADHAN15 sits at 890/900.
  const exhausted = r.usageLimit != null && r.usedCount >= r.usageLimit;
  const status: Discount["status"] =
    r.status === "nonaktif"
      ? "nonaktif"
      : exhausted
        ? "habis"
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

/**
 * Rupiah customers ACTUALLY saved: `Σ orders.discount_idr`.
 *
 * The Diskon dashboard used to render a `estimateSaving()` whose own comment said "Fabricated" — it
 * multiplied `used_count` by a hardcoded `AVG_ORDER = 200.000` and rendered ≈Rp90,3jt for this store,
 * while the true figure is **0 over 0 discounted orders**. `orders.discount_idr` has existed all
 * along. A money tile on a dashboard is read as money, whatever the word "perkiraan" beside it says —
 * the same class `lib/data/marketing.ts` was cleaned up for ("a merchant could raise a real ad budget
 * on a return that never happened").
 */
export async function getDiscountSavings(): Promise<number> {
  return withCurrentTenant(discountSavingsFor);
}

/**
 * ⚠️ A CANCELLED ORDER DEDUCTED NOTHING. The `where` used to be `eq(orders.storeId, storeId)` and
 * nothing else, so a `batal` order's `discount_idr` was summed into a tile captioned *"nilai yang
 * benar-benar dipotong"* — while `applyOrderStatusChange` had already restored its stock and
 * `settleOrderLedger` had already clawed its sale back. Measured on real Postgres: one Rp20.000
 * voucher on a completed sale, one Rp50.000 on a cancelled order and one Rp30.000 on a return read
 * **Rp100.000** where the money that actually left the till is Rp20.000.
 *
 * `status <> 'batal'` is the repo's own `NOT_CANCELLED` rule (`lib/data/analytics.ts`), which every
 * other money aggregate on a merchant screen already applies. ⚠️ `retur` is deliberately LEFT IN:
 * a returned parcel WAS sold at the discounted price before it came back, and whether a refunded
 * order still counts as a customer saving is a business question, not a bug — `lib/data/finance.ts`
 * answers it the other way (`SALES` excludes both). Changing that is an owner's call, not a
 * silent one; the split is named here so the next reader can see both standards exist.
 *
 * Separable from `withCurrentTenant` so `discounts.test.ts` can run the REAL query under
 * `SET LOCAL ROLE tokophi_app` against a throwaway database — the same seam `dailyStatsRows` uses.
 */
export async function discountSavingsFor(db: Tx, storeId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.orders.discountIdr}), 0)`.mapWith(Number) })
    .from(schema.orders)
    .where(and(eq(schema.orders.storeId, storeId), ne(schema.orders.status, "batal")));
  return row?.total ?? 0;
}
