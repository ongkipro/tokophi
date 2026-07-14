import { getAbandonedCarts, getCheckoutMetrics } from "@/lib/data/checkout";
import { KeranjangClient } from "./keranjang-client";

export const dynamic = "force-dynamic";

export default async function KeranjangDitinggalPage() {
  const [carts, metrics] = await Promise.all([getAbandonedCarts(), getCheckoutMetrics()]);
  return <KeranjangClient carts={carts} metrics={metrics} />;
}
