import { getPlatform, getInvoices, getPlanDistribution } from "@/lib/data";
import { PaketClient } from "./paket-client";

export const dynamic = "force-dynamic";

export default async function PaketPage() {
  const [platform, invoices, planDist] = await Promise.all([
    getPlatform(),
    getInvoices(),
    getPlanDistribution(),
  ]);
  return (
    <PaketClient
      mrr={platform.mrr}
      activeStores={platform.activeStores}
      allInvoices={invoices}
      planDist={planDist}
    />
  );
}
