"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

const DAY = 86_400_000;
const KIND = { persen: "persen", nominal: "nominal", ongkir: "gratis_ongkir" } as const;

export type DiscountInput = {
  code: string;
  type: "persen" | "nominal" | "ongkir";
  value: number;
  limit?: number | null;
  status: "aktif" | "terjadwal";
  period: number; // days until it ends
};

// `startsAt` is the ANCHOR the period is measured from — the caller supplies it so an UPDATE can pass
// the voucher's existing one. `fields()` used to mint a fresh anchor on every call, and `updateDiscount`
// wrote it: a live voucher's `starts_at` jumped to yesterday on every Simpan, which (because `period`
// is derived from `ends - now` while the anchor is `now - 1d`) walked `ends_at` **one day earlier per
// save**, and a promo genuinely scheduled for next month was rescheduled to two days from now with
// nothing on screen saying so. The editor has no start-date field, so it cannot be intending either.
function fields(i: DiscountInput, startsAt: Date) {
  // Blank period = no end date. The editor already promises this ("Kosongkan untuk diskon tanpa
  // batas waktu"); `Math.max(1, …)` turned that promise into a voucher that died the next day.
  // `ends_at` is nullable and `applyDiscount` already skips the check when it is null.
  const days = i.period && i.period > 0 ? i.period : null;
  const endsAt = days ? new Date(startsAt.getTime() + days * DAY) : null;
  return {
    code: i.code.trim().toUpperCase(),
    kind: KIND[i.type],
    value: i.type === "ongkir" ? 0 : Math.max(0, i.value || 0),
    usageLimit: i.limit && i.limit > 0 ? i.limit : null,
    endsAt,
    status: i.status,
  };
}

// ⚠️ The real clock. This was anchored to the seed's frame (`2026-06-30`) while time kept moving, so
// EVERY voucher a merchant created was born already expired and the gap widened a day per day.
function newAnchor(status: DiscountInput["status"]): Date {
  const now = Date.now();
  return status === "terjadwal" ? new Date(now + 2 * DAY) : new Date(now - DAY);
}

export async function createDiscount(input: DiscountInput): Promise<string> {
  const { storeId: sid } = await requireCapability("discounts:write");
  const startsAt = newAnchor(input.status);
  const id = await withTenant(sid, async (db) => {
    const [d] = await db.insert(schema.discounts).values({ storeId: sid, startsAt, ...fields(input, startsAt) }).returning();
    return d.id;
  });
  revalidatePath("/diskon");
  return id;
}

export async function updateDiscount(id: string, input: DiscountInput): Promise<void> {
  const { storeId: sid } = await requireCapability("discounts:write");
  await withTenant(sid, async (db) => {
    // Read the voucher's OWN anchor and keep it: an edit changes the discount, not its schedule.
    // (The read is also the tenant check — `discounts` is RLS'd, so a foreign id returns nothing and
    // the update below is skipped rather than silently no-opping.)
    const [cur] = await db
      .select({ startsAt: schema.discounts.startsAt })
      .from(schema.discounts)
      .where(eq(schema.discounts.id, id))
      .limit(1);
    if (!cur) return;
    const startsAt = cur.startsAt ?? newAnchor(input.status);
    await db.update(schema.discounts).set(fields(input, startsAt)).where(eq(schema.discounts.id, id));
  });
  revalidatePath("/diskon");
  revalidatePath(`/diskon/${id}`);
}

export async function deleteDiscount(id: string): Promise<void> {
  const { storeId: sid } = await requireCapability("discounts:write");
  await withTenant(sid, async (db) => {
    // `discount_usages` has no store_id and no RLS, so this DELETE is NOT scoped by the tenant —
    // only the parent read is. Without it, `discounts` (RLS'd) silently no-ops on a foreign id while
    // the usages delete lands anyway: a blind-fire cross-tenant wipe of another store's redemption
    // trail, returning no error either way. Same shape as e61df25; this call site was missed by it.
    const [owned] = await db.select({ id: schema.discounts.id }).from(schema.discounts).where(eq(schema.discounts.id, id)).limit(1);
    if (!owned) return;
    await db.delete(schema.discountUsages).where(eq(schema.discountUsages.discountId, id));
    await db.delete(schema.discounts).where(eq(schema.discounts.id, id));
  });
  revalidatePath("/diskon");
}
