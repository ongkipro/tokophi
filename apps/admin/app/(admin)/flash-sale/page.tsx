import { getFlashSales } from "@/lib/data/flash";
import { getPromoHub } from "@/lib/actions/promo-hub";
import { FlashSaleClient } from "./flash-sale-client";
import { PromoHubCard } from "@/components/admin/promo-hub-card";

export const dynamic = "force-dynamic";

export default async function FlashSalePage() {
  const [sales, hub] = await Promise.all([getFlashSales(), getPromoHub()]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PromoHubCard initial={hub} />
      <FlashSaleClient sales={sales} />
    </div>
  );
}
