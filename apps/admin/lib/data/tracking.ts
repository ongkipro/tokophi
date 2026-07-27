import "server-only";
import { schema } from "@tokophi/db";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import { eq } from "drizzle-orm";

// Read the store's marketing-pixel / conversion-tracking config for the Pemasaran → Pelacakan setup.
// The CAPI token ciphertext is NEVER returned to the client — the UI only needs to know whether one is
// stored (`capiConfigured`), so a merchant can tell "a token is saved" without the secret leaving the
// server. (ADR 0012 §9.2: merchant UI reads MUST exclude token ciphertext.)
export type TrackingChannelKey = "meta" | "google" | "tiktok";

export type TrackingConfig = {
  channel: TrackingChannelKey;
  enabled: boolean;
  pixelId: string;
  capiEnabled: boolean;
  /** true = a CAPI token is stored (its value is never sent to the client). */
  capiConfigured: boolean;
  advancedMatching: boolean;
  testEventCode: string;
};

const KEYS: TrackingChannelKey[] = ["meta", "google", "tiktok"];

function empty(channel: TrackingChannelKey): TrackingConfig {
  return { channel, enabled: false, pixelId: "", capiEnabled: false, capiConfigured: false, advancedMatching: false, testEventCode: "" };
}

export async function getTrackingConfig(): Promise<TrackingConfig[]> {
  return withCurrentTenant(async (db: Tx) => {
    const rows = await db.select().from(schema.storeTrackingChannels);
    const byKey = new Map(rows.map((r) => [r.channel, r]));
    // Always return all three channels (a channel with no row yet renders as an empty, off card).
    return KEYS.map((k) => {
      const r = byKey.get(k);
      if (!r) return empty(k);
      return {
        channel: k,
        enabled: r.enabled,
        pixelId: r.pixelId ?? "",
        capiEnabled: r.capiEnabled,
        capiConfigured: !!r.capiTokenCiphertext,
        advancedMatching: r.advancedMatching,
        testEventCode: r.testEventCode ?? "",
      };
    });
  });
}

// Storefront-facing read (used later by the pixel bootstrap): the ENABLED channels + their public pixel
// ids. Runs on the storefront's owner connection with an explicit store_id (like the rest of the public
// catalog), so it takes storeId and a db handle rather than the session. Never returns the CAPI token.
export async function enabledPixels(db: Tx, storeId: string): Promise<{ channel: TrackingChannelKey; pixelId: string; advancedMatching: boolean }[]> {
  const rows = await db
    .select({ channel: schema.storeTrackingChannels.channel, pixelId: schema.storeTrackingChannels.pixelId, advancedMatching: schema.storeTrackingChannels.advancedMatching, enabled: schema.storeTrackingChannels.enabled })
    .from(schema.storeTrackingChannels)
    .where(eq(schema.storeTrackingChannels.storeId, storeId));
  return rows
    .filter((r) => r.enabled && r.pixelId && r.pixelId.trim())
    .map((r) => ({ channel: r.channel as TrackingChannelKey, pixelId: r.pixelId!.trim(), advancedMatching: r.advancedMatching }));
}
