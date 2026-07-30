import { getDiscounts, getDiscountSavings } from "@/lib/data/discounts";
import { DiskonClient } from "./diskon-client";

export const dynamic = "force-dynamic";

export default async function DiskonPage() {
  const [discounts, savings] = await Promise.all([getDiscounts(), getDiscountSavings()]);
  return <DiskonClient discounts={discounts} savings={savings} />;
}
