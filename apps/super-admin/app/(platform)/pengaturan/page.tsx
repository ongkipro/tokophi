import { getPaymentGateways, getCouriers, getAggregator } from "@/lib/data";
import { PengaturanClient } from "./pengaturan-client";

export const dynamic = "force-dynamic";

export default async function PengaturanPage() {
  const [gateways, couriers, aggregator] = await Promise.all([
    getPaymentGateways(),
    getCouriers(),
    getAggregator(),
  ]);
  return <PengaturanClient gateways={gateways} couriers={couriers} aggregator={aggregator} />;
}
