import { notFound } from "next/navigation";
import { DISCOUNTS } from "@/lib/mock/store";
import { DiscountEditor } from "./discount-editor";

export function generateStaticParams() {
  return DISCOUNTS.map((d) => ({ id: d.id }));
}

export default async function EditDiscountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const discount = DISCOUNTS.find((d) => d.id === id);
  if (!discount) notFound();
  return <DiscountEditor discount={discount} />;
}
