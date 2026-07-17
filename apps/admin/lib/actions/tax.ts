"use server";
import { schema } from "@tokophi/db";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { getSession } from "@/lib/auth";
import { withCurrentTenant, withTenant } from "@/lib/tenant";

// Merchant PPN settings (Pengaturan → Pajak). The order API reads these columns to price PPN on
// storefront sales (see /api/public/order + @tokophi/lib/tax). OFF unless the merchant turns it on.
export type TaxSettingsForm = { enabled: boolean; ratePct: number; inclusive: boolean };

export async function getTaxSettings(): Promise<TaxSettingsForm> {
  if (!(await getSession())) return { enabled: false, ratePct: 11, inclusive: false };
  return withCurrentTenant(async (db) => {
    const [s] = await db
      .select({
        enabled: schema.storeSettings.taxEnabled,
        ratePct: schema.storeSettings.taxRatePct,
        inclusive: schema.storeSettings.taxInclusive,
      })
      .from(schema.storeSettings)
      .limit(1);
    return { enabled: s?.enabled ?? false, ratePct: s?.ratePct ?? 11, inclusive: s?.inclusive ?? false };
  });
}

export async function saveTaxSettings(input: TaxSettingsForm): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  // A percentage — clamp to a sane 0–100; junk never reaches the money math (computeTax guards ≤0 too).
  const ratePct = Math.max(0, Math.min(100, Math.round(input.ratePct) || 0));
  const values = { taxEnabled: input.enabled, taxRatePct: ratePct, taxInclusive: input.inclusive };
  await withTenant(storeId, (db) =>
    db.insert(schema.storeSettings).values({ storeId, ...values }).onConflictDoUpdate({ target: schema.storeSettings.storeId, set: values }),
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}
