import { getFlashSales } from "@/lib/data/flash";
import { FlashSaleClient } from "./flash-sale-client";

export const dynamic = "force-dynamic";

export default async function FlashSalePage() {
  const sales = await getFlashSales();
  return <FlashSaleClient sales={sales} />;
}
