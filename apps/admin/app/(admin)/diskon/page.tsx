import { getDiscounts } from "@/lib/data/discounts";
import { DiskonClient } from "./diskon-client";

export const dynamic = "force-dynamic";

export default async function DiskonPage() {
  const discounts = await getDiscounts();
  return <DiskonClient discounts={discounts} />;
}
