import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { getDiscount } from "@/lib/data/discounts";
import { DiscountEditor } from "./discount-editor";

export const dynamic = "force-dynamic";

export default async function EditDiscountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A non-UUID segment reaches `eq(x.id, id)` and Postgres THROWS 22P02 — a 500 where a 404 belongs.
  // `/produk/…` takes the catalog NUMBER, so merchants do try `/<this route>/1042`. See lib/uuid.ts.
  if (!isUuid(id)) notFound();
  const discount = await getDiscount(id);
  if (!discount) notFound();
  return <DiscountEditor discount={discount} />;
}
