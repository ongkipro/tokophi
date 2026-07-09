import { getInvoices, getSubscriptionStats } from "@/lib/data";
import { PaketClient } from "./paket-client";

export const dynamic = "force-dynamic";

export default async function PaketPage() {
  const [invoices, sub] = await Promise.all([getInvoices(), getSubscriptionStats()]);
  return <PaketClient sub={sub} allInvoices={invoices} />;
}
