"use server";
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireCapability } from "@/lib/rbac";
import { withCurrentTenant, withTenant } from "@/lib/tenant";
import type { FeeBearer } from "@tokophi/lib/payment-fees";

// Payment channels the PLATFORM (super-admin) enabled — the pool a merchant may offer.
// platform_payment_channels is global (not tenant-scoped) → read on the owner connection.
export type PlatformChannel = { channel: string; label: string; kind: string };
export async function getPlatformChannels(): Promise<PlatformChannel[]> {
  if (!(await getSession())) return [];
  const rows = await db
    .select({ channel: schema.platformPaymentChannels.channel, label: schema.platformPaymentChannels.label, kind: schema.platformPaymentChannels.kind, enabled: schema.platformPaymentChannels.enabled, active: schema.platformPaymentChannels.active })
    .from(schema.platformPaymentChannels)
    .orderBy(schema.platformPaymentChannels.id);
  return rows.filter((r) => r.enabled && r.active).map((r) => ({ channel: r.channel, label: r.label, kind: r.kind }));
}

// The merchant's chosen subset (store_settings.paymentChannels; NULL = offer all available).
export async function getStoreChannels(): Promise<string[] | null> {
  if (!(await getSession())) return null;
  return withCurrentTenant(async (db) => {
    const [s] = await db.select({ ch: schema.storeSettings.paymentChannels }).from(schema.storeSettings).limit(1);
    return s?.ch ?? null;
  });
}

export async function saveStoreChannels(channels: string[]): Promise<{ ok: boolean; error?: string }> {
  const { storeId } = await requireCapability("settings:write");
  await withTenant(storeId, (db) =>
    db.insert(schema.storeSettings).values({ storeId, paymentChannels: channels }).onConflictDoUpdate({ target: schema.storeSettings.storeId, set: { paymentChannels: channels } }),
  );
  revalidatePath("/pengaturan");
  return { ok: true };
}

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
