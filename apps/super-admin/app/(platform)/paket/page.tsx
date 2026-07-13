import { getInvoices, getSubscriptionStats, getConversion, getFinanceStats } from "@/lib/data";
import { PaketClient } from "./paket-client";

export const dynamic = "force-dynamic";

export default async function PaketPage() {
  const [invoices, sub, conv, fin] = await Promise.all([
    getInvoices(),
    getSubscriptionStats(),
    getConversion(),
    getFinanceStats(),
  ]);
  return <PaketClient sub={sub} allInvoices={invoices} conv={conv} fin={fin} />;
}
