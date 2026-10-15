import "server-only";
import { schema } from "@tokophi/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { withCurrentTenant } from "@/lib/tenant";
import { systemDomainFor } from "@/lib/data/domain";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac-policy";
import { affiliateContactView } from "@/lib/affiliate-mask";

// Seller panel → Affiliate (Task 9.4, specs/AFFILIATE_SPEC.md). Every read runs under the tenant
// context (RLS) AND filters on `storeId` explicitly — the WHERE is the rule, the policy is the net.

export type AffiliateStatus = "menunggu" | "aktif" | "ditolak" | "nonaktif";
/** Display state of a commission. `siap` and `ditahan` are DERIVED from `eligible_at`, never stored. */
export type CommissionState = "belum_selesai" | "ditahan" | "siap" | "dibayar" | "batal";

export type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  bank: string | null;
  /** True when phone/email/bank above are masked for this viewer (F-A12) — no WhatsApp link then. */
  contactMasked: boolean;
  status: AffiliateStatus;
  note: string | null;
  createdAt: string;
  orders: number;
  owedIdr: number; // siap dibayar
  heldIdr: number; // pending, not yet payable
  paidIdr: number;
};

export type CommissionRow = {
  id: string;
  orderNumber: string;
  affiliateName: string;
  affiliateCode: string;
  source: string;
  baseIdr: number;
  commissionIdr: number;
  rateNote: string | null;
  state: CommissionState;
  eligibleAt: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type AffiliateProgram = {
  /** `<slug>.tokophi.id` — the base of every share link and of the public `/affiliate` form. */
  storeHost: string;
  settings: { enabled: boolean; rateBps: number; holdDays: number };
  affiliates: AffiliateRow[];
  commissions: CommissionRow[];
  overrides: { productId: string; title: string; rateBps: number }[];
  products: { id: string; title: string }[];
};

export async function getAffiliateProgram(): Promise<AffiliateProgram> {
  const session = await getSession();
  const fullContact = !!session && can(session.role, "affiliates:write");
  return withCurrentTenant(async (db, storeId) => {
    const [s] = await db
      .select({
        enabled: schema.storeSettings.affiliateEnabled,
        rateBps: schema.storeSettings.affiliateRateBps,
        holdDays: schema.storeSettings.affiliateHoldDays,
      })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.storeId, storeId))
      .limit(1);

    const [store] = await db
      .select({ slug: schema.stores.slug })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId)) // `stores` has no store_id: the explicit filter IS the boundary
      .limit(1);

    const c = schema.affiliateCommissions;
    const ready = sql`${c.status} = 'pending' and ${c.eligibleAt} is not null and ${c.eligibleAt} <= now()`;
    const affiliates = await db
      .select({
        id: schema.affiliates.id,
        code: schema.affiliates.code,
        name: schema.affiliates.name,
        phone: schema.affiliates.phone,
        email: schema.affiliates.email,
        bankName: schema.affiliates.bankName,
        bankAccount: schema.affiliates.bankAccount,
        bankHolder: schema.affiliates.bankHolder,
        status: schema.affiliates.status,
        note: schema.affiliates.note,
        createdAt: schema.affiliates.createdAt,
        orders: sql<number>`count(${c.id}) filter (where ${c.status} <> 'batal')`.mapWith(Number),
        owedIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${ready}), 0)`.mapWith(Number),
        heldIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${c.status} = 'pending' and not (${ready})), 0)`.mapWith(Number),
        paidIdr: sql<number>`coalesce(sum(${c.commissionIdr}) filter (where ${c.status} = 'dibayar'), 0)`.mapWith(Number),
      })
      .from(schema.affiliates)
      .leftJoin(c, and(eq(c.affiliateId, schema.affiliates.id), eq(c.storeId, storeId)))
      .where(eq(schema.affiliates.storeId, storeId))
      .groupBy(schema.affiliates.id)
      .orderBy(desc(schema.affiliates.createdAt));

    const commissions = await db
      .select({
        id: c.id,
        orderNumber: schema.orders.number,
        affiliateName: schema.affiliates.name,
        affiliateCode: schema.affiliates.code,
        source: c.source,
        baseIdr: c.baseIdr,
        commissionIdr: c.commissionIdr,
        rateNote: c.rateNote,
        status: c.status,
        eligibleAt: c.eligibleAt,
        paidAt: c.paidAt,
        createdAt: c.createdAt,
        isReady: sql<boolean>`${ready}`,
      })
      .from(c)
      .innerJoin(schema.orders, and(eq(schema.orders.id, c.orderId), eq(schema.orders.storeId, storeId)))
      .innerJoin(schema.affiliates, and(eq(schema.affiliates.id, c.affiliateId), eq(schema.affiliates.storeId, storeId)))
      .where(eq(c.storeId, storeId))
      .orderBy(desc(c.createdAt))
      .limit(300);

    const overrides = await db
      .select({
        productId: schema.products.id,
        title: schema.products.title,
        rateBps: sql<number>`${schema.products.affiliateRateBps}`.mapWith(Number),
      })
      .from(schema.products)
      .where(and(eq(schema.products.storeId, storeId), isNotNull(schema.products.affiliateRateBps)))
      .orderBy(schema.products.title);

    const products = await db
      .select({ id: schema.products.id, title: schema.products.title })
      .from(schema.products)
      .where(and(eq(schema.products.storeId, storeId), sql`${schema.products.status} <> 'archived'`))
      .orderBy(schema.products.title)
      .limit(1000);

    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      storeHost: systemDomainFor(store?.slug ?? ""),
      settings: { enabled: s?.enabled ?? false, rateBps: s?.rateBps ?? 1000, holdDays: s?.holdDays ?? 3 },
      affiliates: affiliates.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        ...affiliateContactView(a, fullContact),
        status: a.status,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
        orders: a.orders,
        owedIdr: a.owedIdr,
        heldIdr: a.heldIdr,
        paidIdr: a.paidIdr,
      })),
      commissions: commissions.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        affiliateName: r.affiliateName,
        affiliateCode: r.affiliateCode,
        source: r.source,
        baseIdr: r.baseIdr,
        commissionIdr: r.commissionIdr,
        rateNote: r.rateNote,
        state:
          r.status === "dibayar" ? "dibayar"
          : r.status === "batal" ? "batal"
          : r.isReady ? "siap"
          : r.eligibleAt ? "ditahan"
          : "belum_selesai",
        eligibleAt: iso(r.eligibleAt),
        paidAt: iso(r.paidAt),
        createdAt: r.createdAt.toISOString(),
      })),
      overrides,
      products,
    };
  });
}
