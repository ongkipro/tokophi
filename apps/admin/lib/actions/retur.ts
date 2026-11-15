"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { parseReturnWindow } from "@tokophi/lib/return-window";
import { revalidatePath } from "next/cache";
import { buyerAccountEnabled } from "@tokophi/lib/claim-token";
import { requireCapability } from "@/lib/rbac";
import { getSession } from "@/lib/auth";
import { withCurrentTenant, withTenant } from "@/lib/tenant";

// Pengaturan → Layanan Pembeli → Kebijakan retur. The window the buyer is shown on a finished order
// (ADR 0016, BUYER-ACCOUNT-P1; migration 0123). Empty = the store declares nothing and the buyer is told nothing.

export async function getReturnWindow(): Promise<number | null> {
  if (!(await getSession())) return null;
  return withCurrentTenant(async (db, storeId) => {
    const [s] = await db
      .select({ days: schema.storeSettings.returnWindowDays })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.storeId, storeId))
      .limit(1);
    return s?.days ?? null;
  });
}

export async function saveReturnWindow(input: { days: string | number | null }): Promise<{ ok: boolean; days: number | null; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  // Dormant while the TokoΦ Account feature is OFF (ADR 0016): no screen offers it, and a direct call
  // writes nothing. A value saved earlier stays exactly as it is.
  if (!buyerAccountEnabled()) return { ok: false, days: null, error: "Fitur Akun TokoΦ belum aktif." };
  const parsed = parseReturnWindow(input.days);
  // Refused, never guessed: buyers read this number as the store's promise.
  if (!parsed.ok) return { ok: false, days: null, error: parsed.error };
  const days = parsed.days;
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, returnWindowDays: days })
      .onConflictDoUpdate({ target: schema.storeSettings.storeId, set: { returnWindowDays: days } }),
  );
  revalidatePath("/pengaturan");
  return { ok: true, days };
}
