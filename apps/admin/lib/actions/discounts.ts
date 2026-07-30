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
  // Three states, matching the DB enum. `nonaktif` is the merchant's explicit OFF and must be
  // writable — the editor could only express two, so a switched-off voucher was re-armed on any save.
  status: "aktif" | "terjadwal" | "nonaktif";
  period: number; // days until it ends
};

// ⚠️ THE PERIOD IS MEASURED FROM **NOW**, AND IT HAS TO BE — twice burned on this one line.
//
// `period` reaches this function from `lib/data/discounts.ts`, where `endsInDays = (ends_at − now)`.
// It is days from TODAY, which is also exactly what the editor's own label promises the merchant
// ("Berakhir dalam N hari"). So `ends_at` must be `now + N days`.
//
// It has been wrong in both directions:
//  · Originally the anchor was `newAnchor()` on every save (`now − 1d`), which walked `ends_at` back
//    ONE DAY per Simpan and rescheduled a future promo to two days out.
//  · Then it anchored on the row's EXISTING `starts_at` — which looked like the conservative fix and
//    was far worse: `ends_at := starts_at + (ends_at − now)` collapses the interval by the whole age
//    of the voucher, IN A SINGLE SAVE. Replayed against the live rows: GAJIAN25 08-23 → 06-24,
//    MEMBERVIP 08-29 → 06-29, FLASH1212 08-14 → 07-19. Open a voucher, change nothing, press Simpan,
//    and it is dead — under a toast that says "Perubahan disimpan".
//
// `starts_at` is left ALONE on update (a separate argument, never written), so an edit changes the
// discount and not its schedule. That part was right and stays.
// `current` = the row's existing `ends_at` on an UPDATE, `undefined` on a CREATE. It is what makes a
// blank period mean two different, both-correct things — see below.
function fields(i: DiscountInput, current?: Date | null) {
  const days = i.period && i.period > 0 ? i.period : null;
  // ⚠️ A BLANK PERIOD MUST NOT RESURRECT AN EXPIRED VOUCHER.
  //
  // On CREATE, blank means "tanpa batas waktu" — `ends_at: null`, exactly what the editor promises.
  // On UPDATE it cannot mean that, because the editor seeds the field from `endsInDays` clamped at 0
  // (`Math.max(0, …)`), so an ALREADY-EXPIRED voucher arrives here indistinguishable from a blank
  // one. Nulling it would hand a dead voucher eternal life on a Simpan the merchant made to change
  // something else entirely. Replayed on the live rows: RAMADHAN15 (expired 41 days ago, 890/900
  // used, `nonaktif`) and NEWUSER50K both became never-expiring.
  //
  // So on update a blank period LEAVES THE SCHEDULE ALONE — which is the same sentence already
  // written about `starts_at` two functions down: an edit changes the discount, not its schedule.
  // Setting a real number still moves `ends_at` to `now + N days`, which is what the label promises.
  const endsAt = days ? new Date(Date.now() + days * DAY) : current !== undefined ? current : null;
  return {
    code: i.code.trim().toUpperCase(),
    kind: KIND[i.type],
    // A percentage has a CEILING. `lib/promo.ts` computes `min(subtotal, subtotal*value/100)`, so
    // `250` typed while the Persentase tab is selected — an easy slip, `nominal` is the next tab and
    // means rupiah — made every order's goods free, with shipping still charged, until someone noticed.
    value:
      i.type === "ongkir" ? 0 : i.type === "persen" ? Math.min(100, Math.max(0, i.value || 0)) : Math.max(0, i.value || 0),
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
    const [d] = await db.insert(schema.discounts).values({ storeId: sid, startsAt, ...fields(input) }).returning();
    return d.id;
  });
  revalidatePath("/diskon");
  return id;
}

export async function updateDiscount(id: string, input: DiscountInput): Promise<void> {
  const { storeId: sid } = await requireCapability("discounts:write");
  await withTenant(sid, async (db) => {
    // Read the row's own dates and keep them unless the merchant actually asked for a new period.
    // (The read is also the tenant check — `discounts` is RLS'd, so a foreign id returns nothing and
    // the update below is skipped rather than silently no-opping.)
    const [cur] = await db
      .select({ startsAt: schema.discounts.startsAt, endsAt: schema.discounts.endsAt })
      .from(schema.discounts)
      .where(eq(schema.discounts.id, id))
      .limit(1);
    if (!cur) return;
    // `starts_at` is deliberately NOT in the update set: an edit changes the discount, not its schedule.
    await db.update(schema.discounts).set(fields(input, cur.endsAt)).where(eq(schema.discounts.id, id));
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
