import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { getInvoices, getSubscriptionStats, getConversion, getFinanceStats } from "@/lib/data";
import { PaketClient } from "./paket-client";

export const dynamic = "force-dynamic";

export default async function PaketPage() {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/paket");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const [invoices, sub, conv, fin] = await Promise.all([
    getInvoices(),
    getSubscriptionStats(),
    getConversion(),
    getFinanceStats(),
  ]);
  return <PaketClient sub={sub} allInvoices={invoices} conv={conv} fin={fin} />;
}
