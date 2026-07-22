import { listPromoPages } from "@/lib/data/promo";
import { listLandings } from "@/lib/data/landing";
import { PromoListClient } from "./promo-list-client";

export const dynamic = "force-dynamic";

export default async function PromoPage() {
  const [rows, landings] = await Promise.all([listPromoPages(), listLandings()]);
  return <PromoListClient rows={rows} landings={landings} />;
}
