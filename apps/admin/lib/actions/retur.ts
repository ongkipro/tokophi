"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { normalizeReturnWindow } from "@tokophi/lib/return-window";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { getSession } from "@/lib/auth";
import { withCurrentTenant, withTenant } from "@/lib/tenant";

// Pengaturan → Pengiriman → Kebijakan retur. The window the buyer is shown on a finished order
// (account spec §19, OD-9). Empty = the store declares nothing and the buyer is told nothing.

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
  const days = normalizeReturnWindow(input.days);
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, returnWindowDays: days })
      .onConflictDoUpdate({ target: schema.storeSettings.storeId, set: { returnWindowDays: days } }),
  );
  revalidatePath("/pengaturan");
  return { ok: true, days };
}
