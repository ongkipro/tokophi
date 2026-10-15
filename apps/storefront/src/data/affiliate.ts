// Store affiliate programme — storefront half (Task 9.5, specs/AFFILIATE_SPEC.md F-A1/F-A2). The store id
// always comes from the Host-resolved `locals.store`, never from the form.
import { db, schema } from "@tokophi/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { suggestAffiliateCode } from "@tokophi/lib/affiliate";

export type AffiliateApplication = {
  name: string;
  /** Canonical `62…` (normalizePhone) — the caller validates before calling. */
  phone: string;
  email: string | null;
  channel: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
};

/** `created` = a new `menunggu` row; `exists` = this phone already applied/joins this store; `failed` = no unique code. */
export async function applyAffiliate(storeId: string, a: AffiliateApplication): Promise<"created" | "exists" | "failed"> {
  const [dupe] = await db
    .select({ id: schema.affiliates.id })
    .from(schema.affiliates)
    .where(and(eq(schema.affiliates.storeId, storeId), eq(schema.affiliates.phone, a.phone)))
    .limit(1);
  if (dupe) return "exists";
  // The per-store unique (store_id, code) decides a clash; a generated code just tries again.
  for (let i = 0; i < 5; i++) {
    const rows = await db
      .insert(schema.affiliates)
      .values({
        storeId,
        code: suggestAffiliateCode(a.name),
        name: a.name,
        phone: a.phone,
        email: a.email,
        bankName: a.bankName,
        bankAccount: a.bankAccount,
        bankHolder: a.bankHolder,
        note: a.channel,
      })
      .onConflictDoNothing()
      .returning({ id: schema.affiliates.id });
    if (rows.length) return "created";
  }
  return "failed";
}

/** Display state of a commission, derived like the Seller panel's (`siap`/`ditahan` from `eligible_at`). */
export type DashboardCommissionState = "belum_selesai" | "ditahan" | "siap" | "dibayar" | "batal";
export type AffiliateDashboard = {
  name: string;
  code: string;
  totals: { heldIdr: number; readyIdr: number; paidIdr: number };
  commissions: {
    orderNumber: string;
    placedAt: Date;
    baseIdr: number;
    commissionIdr: number;
    rateNote: string | null;
    state: DashboardCommissionState;
    eligibleAt: Date | null;
    paidAt: Date | null;
  }[];
};

/** F-A18 self-view: one ACTIVE affiliate of THIS store, or null (unknown, other store, not `aktif`).
 *  Owner connection, so every predicate carries `storeId` explicitly. No buyer data is selected. */
export async function getAffiliateDashboard(storeId: string, affiliateId: string): Promise<AffiliateDashboard | null> {
  const [a] = await db
    .select({ name: schema.affiliates.name, code: schema.affiliates.code })
    .from(schema.affiliates)
    .where(and(eq(schema.affiliates.id, affiliateId), eq(schema.affiliates.storeId, storeId), eq(schema.affiliates.status, "aktif")))
    .limit(1);
  if (!a) return null;
  const c = schema.affiliateCommissions;
  const rows = await db
    .select({
      orderNumber: schema.orders.number,
      placedAt: schema.orders.placedAt,
      baseIdr: c.baseIdr,
      commissionIdr: c.commissionIdr,
      rateNote: c.rateNote,
      status: c.status,
      eligibleAt: c.eligibleAt,
      paidAt: c.paidAt,
      isReady: sql<boolean>`${c.status} = 'pending' and ${c.eligibleAt} is not null and ${c.eligibleAt} <= now()`,
    })
    .from(c)
    .innerJoin(schema.orders, and(eq(schema.orders.id, c.orderId), eq(schema.orders.storeId, storeId)))
    .where(and(eq(c.storeId, storeId), eq(c.affiliateId, affiliateId)))
    .orderBy(desc(c.createdAt))
    .limit(200);
  const commissions = rows.map((r) => ({
    orderNumber: r.orderNumber,
    placedAt: r.placedAt,
    baseIdr: r.baseIdr,
    commissionIdr: r.commissionIdr,
    rateNote: r.rateNote,
    eligibleAt: r.eligibleAt,
    paidAt: r.paidAt,
    state: (r.status === "dibayar" ? "dibayar"
      : r.status === "batal" ? "batal"
      : r.isReady ? "siap"
      : r.eligibleAt ? "ditahan"
      : "belum_selesai") as DashboardCommissionState,
  }));
  // Totals over EVERY commission, not just the 200 listed.
  const ready = sql`${c.status} = 'pending' and ${c.eligibleAt} is not null and ${c.eligibleAt} <= now()`;
  const [t] = await db
    .select({
      heldIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${c.status} = 'pending' and not (${ready})), 0)`.mapWith(Number),
      readyIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${ready}), 0)`.mapWith(Number),
      paidIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${c.status} = 'dibayar'), 0)`.mapWith(Number),
    })
    .from(c)
    .where(and(eq(c.storeId, storeId), eq(c.affiliateId, affiliateId)));
  return { name: a.name, code: a.code, totals: t ?? { heldIdr: 0, readyIdr: 0, paidIdr: 0 }, commissions };
}
