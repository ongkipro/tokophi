import { notFound } from "next/navigation";
import { getCustomer, getCustomerOrders } from "@/lib/data/customers";
import { CustomerDetail } from "./customer-detail";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const orders = await getCustomerOrders(customer.id);
  return <CustomerDetail customer={customer} orders={orders} />;
}
