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

function fields(i: DiscountInput) {
  // ⚠️ This was anchored to the seed's frame (`2026-06-30`) while the clock kept moving, so EVERY
  // voucher a merchant created was born already expired — and opening an existing one and pressing
  // Simpan moved its expiry BACKWARDS. The gap widened a day per day. Use the real clock.
  const now = Date.now();
  // Blank period = no end date. The editor already promises this ("Kosongkan untuk diskon tanpa
  // batas waktu"); `Math.max(1, …)` turned that promise into a voucher that died the next day.
  // `ends_at` is nullable and `applyDiscount` already skips the check when it is null.
  const days = i.period && i.period > 0 ? i.period : null;
  const startsAt = i.status === "terjadwal" ? new Date(now + 2 * DAY) : new Date(now - DAY);
  const endsAt = days ? new Date(startsAt.getTime() + days * DAY) : null;
  return {
    code: i.code.trim().toUpperCase(),
    kind: KIND[i.type],
    value: i.type === "ongkir" ? 0 : Math.max(0, i.value || 0),
    usageLimit: i.limit && i.limit > 0 ? i.limit : null,
    startsAt,
    endsAt,
    status: i.status,
  };
}

export async function createDiscount(input: DiscountInput): Promise<string> {
  const { storeId: sid } = await requireCapability("discounts:write");
  const id = await withTenant(sid, async (db) => {
    const [d] = await db.insert(schema.discounts).values({ storeId: sid, ...fields(input) }).returning();
    return d.id;
  });
  revalidatePath("/diskon");
  return id;
}

export async function updateDiscount(id: string, input: DiscountInput): Promise<void> {
  const { storeId: sid } = await requireCapability("discounts:write");
  await withTenant(sid, (db) => db.update(schema.discounts).set(fields(input)).where(eq(schema.discounts.id, id)));
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
