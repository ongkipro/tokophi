"use server";
import { schema } from "@tokophi/db";
import { parseComplaintDays } from "@tokophi/lib/complaint-service";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { getSession } from "@/lib/auth";
import { withCurrentTenant, withTenant } from "@/lib/tenant";

// Pengaturan → Pengiriman → Layanan pengaduan (account spec OD-12, ACC-17). The store's own complaint-
// resolution period, in working days. Empty = the store declares nothing and the buyer is told nothing.

/** The declared period, and whether the store has the contact the buyer's complaint button needs. */
export async function getComplaintService(): Promise<{ days: number | null; hasWhatsapp: boolean }> {
  if (!(await getSession())) return { days: null, hasWhatsapp: false };
  return withCurrentTenant(async (db, storeId) => {
    const [s] = await db
      .select({ days: schema.storeSettings.complaintResolutionDays })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.storeId, storeId))
      .limit(1);
    // `stores` has no store_id column: filter on the tenant explicitly, the policy is only the net.
    const [st] = await db.select({ wa: schema.stores.whatsapp }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    return { days: s?.days ?? null, hasWhatsapp: !!st?.wa?.trim() };
  });
}

export async function saveComplaintService(input: { days: string | number | null }): Promise<{ ok: boolean; days: number | null; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  const parsed = parseComplaintDays(input.days);
  // Refused, never guessed: buyers read this number as the store's promise.
  if (!parsed.ok) return { ok: false, days: null, error: parsed.error };
  const days = parsed.days;
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, complaintResolutionDays: days })
      .onConflictDoUpdate({ target: schema.storeSettings.storeId, set: { complaintResolutionDays: days } }),
  );
  revalidatePath("/pengaturan");
  return { ok: true, days };
}
