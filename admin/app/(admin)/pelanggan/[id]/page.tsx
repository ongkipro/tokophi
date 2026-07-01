import { CUSTOMERS } from "@/lib/mock/store";
import { notFound } from "next/navigation";
import { CustomerDetail } from "./customer-detail";

export function generateStaticParams() {
  return CUSTOMERS.map((c) => ({ id: c.id }));
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = CUSTOMERS.find((c) => c.id === id);
  if (!customer) notFound();
  return <CustomerDetail customer={customer} />;
}
