import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";

// The store's ENABLED marketing pixels, for the storefront to bootstrap (fbq/gtag/ttq). Runs on the
// storefront's owner connection with an explicit store_id (like the rest of the catalog reads) — the
// pixel id is PUBLIC (it ships in the page's JS), and the CAPI token is never read here. Configured by
// the merchant at Pemasaran → Pelacakan (store_tracking_channels).
export type StorePixel = { channel: "meta" | "google" | "tiktok"; pixelId: string; advancedMatching: boolean };

export async function storeTrackingPixels(storeId: string): Promise<StorePixel[]> {
  const rows = await db
    .select({
      channel: schema.storeTrackingChannels.channel,
      pixelId: schema.storeTrackingChannels.pixelId,
      advancedMatching: schema.storeTrackingChannels.advancedMatching,
      enabled: schema.storeTrackingChannels.enabled,
    })
    .from(schema.storeTrackingChannels)
    .where(eq(schema.storeTrackingChannels.storeId, storeId));
  return rows
    .filter((r) => r.enabled && r.pixelId && r.pixelId.trim())
    .map((r) => ({ channel: r.channel as StorePixel["channel"], pixelId: r.pixelId!.trim(), advancedMatching: r.advancedMatching }));
}
