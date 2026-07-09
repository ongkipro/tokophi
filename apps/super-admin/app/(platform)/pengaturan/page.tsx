import { getPaymentGateways, getCouriers, getAggregator, getPlatformAdmins, getPaymentChannels } from "@/lib/data";
import { PengaturanClient } from "./pengaturan-client";

export const dynamic = "force-dynamic";

export default async function PengaturanPage() {
  const [gateways, couriers, channels, aggregator, team] = await Promise.all([
    getPaymentGateways(),
    getCouriers(),
    getPaymentChannels(),
    getAggregator(),
    getPlatformAdmins(),
  ]);
  return <PengaturanClient gateways={gateways} couriers={couriers} channels={channels} aggregator={aggregator} team={team} />;
}
