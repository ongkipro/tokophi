import { notFound } from "next/navigation";
import { getDiscount } from "@/lib/data/discounts";
import { DiscountEditor } from "./discount-editor";

export const dynamic = "force-dynamic";

export default async function EditDiscountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const discount = await getDiscount(id);
  if (!discount) notFound();
  return <DiscountEditor discount={discount} />;
}
