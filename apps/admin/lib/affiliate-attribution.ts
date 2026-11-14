import { schema } from "@tokophi/db";
import { computeAffiliateCommission, normalizeAffiliateCode } from "@tokophi/lib/affiliate";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "./ledger-credit";

// Store affiliate programme — the two writes that ride OTHER transactions (specs/AFFILIATE_SPEC.md).
// Both take a `tx` and never open their own: a commission exists only if its order exists (F-A6), and
// it is voided in the same transaction as the cancellation that voids it (F-A7).

export type AttributionInput = {
  storeId: string;
  orderId: string;
  /** Canonical `62…` — the self-referral check (F-A5). */
  buyerPhone: string;
  /** What the shopper typed at checkout. */
  typedCode?: unknown;
  /** The `?ref=` the storefront captured (≤ 30 days old — the storefront enforces the window). */
  refCode?: unknown;
  lines: { productId: string; totalIdr: number }[];
  subtotalIdr: number;
  goodsProceedsIdr: number;
};

/**
 * F-A4/F-A5/F-A6: attribute the order to ONE active affiliate of this store and freeze its commission.
 * A typed code wins when it resolves to an active affiliate; otherwise the captured ref is tried.
 * Returns the row written, or null when the order earns nothing (programme off, no/unknown/inactive
 * code, self-referral). Never throws for a bad code: a wrong code must never cost the sale.
 */
export async function attachAffiliateCommission(tx: Db, a: AttributionInput) {
  const [settings] = await tx
    .select({
      enabled: schema.storeSettings.affiliateEnabled,
      rateBps: schema.storeSettings.affiliateRateBps,
    })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.storeId, a.storeId))
    .limit(1);
  if (!settings?.enabled) return null; // F-A1

  const candidates: { code: string; source: "kode" | "link" }[] = [];
  const typed = normalizeAffiliateCode(a.typedCode);
  const ref = normalizeAffiliateCode(a.refCode);
  if (typed) candidates.push({ code: typed, source: "kode" });
  if (ref && ref !== typed) candidates.push({ code: ref, source: "link" });

  for (const c of candidates) {
    const [aff] = await tx
      .select({ id: schema.affiliates.id, phone: schema.affiliates.phone })
      .from(schema.affiliates)
      .where(
        and(
          eq(schema.affiliates.storeId, a.storeId), // the tenant boundary: a code is unique PER STORE
          eq(schema.affiliates.code, c.code),
          eq(schema.affiliates.status, "aktif"),
        ),
      )
      .limit(1);
    if (!aff) continue;
    if (aff.phone === a.buyerPhone) return null; // F-A5 self-referral: the affiliate bought for themselves

    const productIds = [...new Set(a.lines.map((l) => l.productId))];
    const overrides = productIds.length
      ? await tx
          .select({ id: schema.products.id, rateBps: schema.products.affiliateRateBps })
          .from(schema.products)
          .where(and(eq(schema.products.storeId, a.storeId), inArray(schema.products.id, productIds)))
      : [];
    const rateOf = new Map(overrides.map((o) => [o.id, o.rateBps]));
    const result = computeAffiliateCommission({
      lines: a.lines.map((l) => ({ totalIdr: l.totalIdr, rateBps: rateOf.get(l.productId) ?? null })),
      subtotalIdr: a.subtotalIdr,
      goodsProceedsIdr: a.goodsProceedsIdr,
      defaultRateBps: settings.rateBps,
    });
    const [row] = await tx
      .insert(schema.affiliateCommissions)
      .values({
        storeId: a.storeId,
        affiliateId: aff.id,
        orderId: a.orderId,
        source: c.source,
        baseIdr: result.baseIdr,
        commissionIdr: result.commissionIdr,
        rateNote: result.rateNote,
      })
      .onConflictDoNothing({ target: schema.affiliateCommissions.orderId })
      .returning();
    return row ?? null;
  }
  return null;
}

/**
 * F-A7, called by `applyOrderStatusChange` inside its transaction. `batal`/`retur` void a commission
 * that has not been paid; `selesai` starts the hold window. A `dibayar` row is never touched — the
 * merchant already sent that money (a claw-back is an open owner question, AFFILIATE_SPEC §10).
 */
export async function onOrderStatusForAffiliate(
  tx: Db,
  args: { storeId: string; orderId: string; status: string },
) {
  const where = and(
    eq(schema.affiliateCommissions.storeId, args.storeId),
    eq(schema.affiliateCommissions.orderId, args.orderId),
    ne(schema.affiliateCommissions.status, "dibayar"),
  );
  if (args.status === "batal" || args.status === "retur") {
    await tx.update(schema.affiliateCommissions).set({ status: "batal" }).where(where);
  } else if (args.status === "selesai") {
    await tx
      .update(schema.affiliateCommissions)
      .set({
        eligibleAt: sql`now() + make_interval(days => coalesce((select affiliate_hold_days from store_settings where store_id = ${args.storeId}), 3))`,
      })
      .where(and(where, eq(schema.affiliateCommissions.status, "pending")));
  }
}
