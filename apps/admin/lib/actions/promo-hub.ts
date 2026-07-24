"use server";
import { schema } from "@tokophi/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireCapability } from "@/lib/rbac";
import { withCurrentTenant, withTenant } from "@/lib/tenant";

// Promo hub (/promo) banner config (PROMO P4b) — merchant-configurable title/subtitle/banner. Empty =
// the storefront falls back to defaults, so the hub always renders. Mirrors getFreeShip/setFreeShip.
export type PromoHubConfig = { title: string; subtitle: string; bannerUrl: string };

export async function getPromoHub(): Promise<PromoHubConfig> {
  if (!(await getSession())) return { title: "", subtitle: "", bannerUrl: "" };
  return withCurrentTenant(async (db) => {
    const [s] = await db
      .select({ title: schema.storeSettings.promoHubTitle, subtitle: schema.storeSettings.promoHubSubtitle, bannerUrl: schema.storeSettings.promoHubBannerUrl })
      .from(schema.storeSettings)
      .limit(1);
    return { title: s?.title ?? "", subtitle: s?.subtitle ?? "", bannerUrl: s?.bannerUrl ?? "" };
  });
}

export async function setPromoHub(input: PromoHubConfig): Promise<{ ok: boolean }> {
  const { storeId } = await requireCapability("settings:write");
  const clean = (s: string) => (s && s.trim() ? s.trim() : null);
  const vals = { promoHubTitle: clean(input.title), promoHubSubtitle: clean(input.subtitle), promoHubBannerUrl: clean(input.bannerUrl) };
  await withTenant(storeId, (db) =>
    db
      .insert(schema.storeSettings)
      .values({ storeId, ...vals })
      .onConflictDoUpdate({ target: schema.storeSettings.storeId, set: vals }),
  );
  revalidatePath("/flash-sale");
  return { ok: true };
}
