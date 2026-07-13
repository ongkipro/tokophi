"use server";
import { db, schema } from "@tokophi/db";
import { getSession } from "@/lib/auth";

// Payment channels the PLATFORM (super-admin) enabled. platform_payment_channels is global
// (not tenant-scoped) → read on the owner connection.
//
// The merchant does NOT choose payment channels: the platform enables them and they flow straight
// to the shopper's checkout (storefront `enabledPaymentChannels()` reads this same table). The old
// client-admin "Pembayaran" tab wrote store_settings.payment_channels / payment_fee_bearer, and
// NOTHING ever read those columns — the storefront ignored them and the order API validates against
// AUTOLARIS_KNOWN_CHANNELS. It was an illusion of control, so it was removed.
//
// This function survives because the merchant still needs a channel to pay THEIR OWN TokoΦ
// subscription with (/akun/langganan) — a different concern from the shopper's checkout.
export type PlatformChannel = { channel: string; label: string; kind: string };
export async function getPlatformChannels(): Promise<PlatformChannel[]> {
  if (!(await getSession())) return [];
  const rows = await db
    .select({ channel: schema.platformPaymentChannels.channel, label: schema.platformPaymentChannels.label, kind: schema.platformPaymentChannels.kind, enabled: schema.platformPaymentChannels.enabled, active: schema.platformPaymentChannels.active })
    .from(schema.platformPaymentChannels)
    .orderBy(schema.platformPaymentChannels.id);
  return rows.filter((r) => r.enabled && r.active).map((r) => ({ channel: r.channel, label: r.label, kind: r.kind }));
}
