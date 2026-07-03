import "server-only";
import { db, schema } from "@indostore/db";
import { isNull } from "drizzle-orm";
import type { AdChannel, AdCampaign, ProvinceStat } from "@/lib/mock/store";

const ORDER: Record<string, number> = { meta: 0, google: 1, tiktok: 2 };

export async function getAdChannels(): Promise<AdChannel[]> {
  const rows = await db.select().from(schema.adChannels);
  return rows
    .map((r) => ({
      key: r.key,
      name: r.name ?? "",
      brand: r.brand ?? "#666",
      connected: r.connected,
      pixelLabel: r.pixelLabel ?? "",
      pixelId: r.pixelId ?? "",
      pixelActive: r.pixelActive,
      capiActive: r.capiEnabled,
      spend: r.spendIdr,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      revenue: r.revenueIdr,
      campaigns: (r.campaigns as AdCampaign[] | null) ?? [],
    }))
    .sort((a, b) => (ORDER[a.key] ?? 9) - (ORDER[b.key] ?? 9));
}

// Per-province rollup (channel_key IS NULL rows).
export async function getProvinceStats(): Promise<ProvinceStat[]> {
  const rows = await db.select().from(schema.adMetrics).where(isNull(schema.adMetrics.channelKey));
  return rows.map((r) => ({
    province: r.province ?? "",
    spend: r.spendIdr,
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    revenue: r.revenueIdr,
    reach: r.reach,
  }));
}
