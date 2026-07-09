"use server";
import { schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withCurrentTenant, withTenant } from "@/lib/tenant";
import type { FeeBearer } from "@tokophi/lib/payment-fees";

// Who bears the storefront payment-gateway fee for this store (seller | buyer | split).
export async function getFeeBearer(): Promise<FeeBearer> {
  return withCurrentTenant(async (db) => {
    const [s] = await db.select({ b: schema.storeSettings.paymentFeeBearer }).from(schema.storeSettings).limit(1);
    return (s?.b as FeeBearer) ?? "seller";
  });
}

export async function setFeeBearer(bearer: FeeBearer): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  if (!["seller", "buyer", "split"].includes(bearer)) return { ok: false, error: "Pilihan tidak valid." };
  await withTenant(storeId, (db) =>
    db.insert(schema.storeSettings).values({ storeId, paymentFeeBearer: bearer }).onConflictDoUpdate({ target: schema.storeSettings.storeId, set: { paymentFeeBearer: bearer } }),
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}
