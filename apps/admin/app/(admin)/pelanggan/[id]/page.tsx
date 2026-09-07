import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { getCustomer, getCustomerOrders } from "@/lib/data/customers";
import { CustomerDetail } from "./customer-detail";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-UUID segment reaches `eq(x.id, id)` and Postgres THROWS 22P02 — a 500 where a 404 belongs.
  // `/produk/…` takes the catalog NUMBER, so merchants do try `/<this route>/1042`. See @tokophi/lib/uuid.
  if (!isUuid(id)) notFound();
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const orders = await getCustomerOrders(customer.id);
  return <CustomerDetail customer={customer} orders={orders} />;
}
