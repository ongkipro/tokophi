import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import { cached } from "./cache";

// The store's ENABLED marketing pixels, for the storefront to bootstrap (fbq/gtag/ttq). Runs on the
// storefront's owner connection with an explicit store_id (like the rest of the catalog reads) — the
// pixel id is PUBLIC (it ships in the page's JS), and the CAPI token is never read here. Configured by
// the merchant at Pemasaran → Pelacakan (store_tracking_channels).
export type StorePixel = {
  channel: "meta" | "google" | "tiktok";
  pixelId: string;
  advancedMatching: boolean;
  /**
   * Google Ads conversion destination (`AW-…/label`), `null` when the merchant has not wired Google Ads.
   * PUBLIC by nature — like the pixel id, it ships in the page's JS; it is a destination, not a secret.
   */
  adsSendTo: string | null;
};

/**
 * ⚠️ CACHED, like every other storefront read. This runs in the frontmatter of a component rendered by
 * EVERY layout, so uncached it was one Postgres round-trip on the SSR critical path of every page —
 * including 404s and bot traffic — for a row a merchant changes maybe twice in a shop's lifetime. Same
 * 15 s TTL as the catalog, so a merchant who pastes a pixel id still sees it on the next page load.
 */
export async function storeTrackingPixels(storeId: string): Promise<StorePixel[]> {
  return cached(`pixels:${storeId}`, () => loadTrackingPixels(storeId));
}

async function loadTrackingPixels(storeId: string): Promise<StorePixel[]> {
  const rows = await db
    .select({
      channel: schema.storeTrackingChannels.channel,
      pixelId: schema.storeTrackingChannels.pixelId,
      advancedMatching: schema.storeTrackingChannels.advancedMatching,
      adsSendTo: schema.storeTrackingChannels.adsSendTo,
      enabled: schema.storeTrackingChannels.enabled,
    })
    .from(schema.storeTrackingChannels)
    .where(eq(schema.storeTrackingChannels.storeId, storeId));
  return rows
    .filter((r) => r.enabled && r.pixelId && r.pixelId.trim())
    .map((r) => ({
      channel: r.channel as StorePixel["channel"],
      pixelId: r.pixelId!.trim(),
      advancedMatching: r.advancedMatching,
      adsSendTo: r.adsSendTo?.trim() || null,
    }));
}
