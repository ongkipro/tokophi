import { getPaymentGateways, getCouriers, getAggregator, getPlatformAdmins } from "@/lib/data";
import { PengaturanClient } from "./pengaturan-client";

export const dynamic = "force-dynamic";

export default async function PengaturanPage() {
  const [gateways, couriers, aggregator, team] = await Promise.all([
    getPaymentGateways(),
    getCouriers(),
    getAggregator(),
    getPlatformAdmins(),
  ]);
  return <PengaturanClient gateways={gateways} couriers={couriers} aggregator={aggregator} team={team} />;
}
