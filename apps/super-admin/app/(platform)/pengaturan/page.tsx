import { getPaymentGateways, getCouriers, getAggregator, getPlatformAdmins, getPaymentChannels } from "@/lib/data";
import { getPlatformSession } from "@/lib/platform-auth";
import { PengaturanClient } from "./pengaturan-client";

export const dynamic = "force-dynamic";

export default async function PengaturanPage() {
  const [gateways, couriers, channels, aggregator, team, me] = await Promise.all([
    getPaymentGateways(),
    getCouriers(),
    getPaymentChannels(),
    getAggregator(),
    getPlatformAdmins(),
    // Who is looking — ONLY to decide whether the owner-only affordance is drawn. The boundary is
    // `platformGate("owner")` inside the action; this is so a `support` operator is not offered a
    // button that can only ever refuse. Re-read from `platform_admins` on every request like every
    // other rank check (never from the cookie's claims).
    getPlatformSession(),
  ]);
  return (
    <PengaturanClient
      gateways={gateways}
      couriers={couriers}
      channels={channels}
      aggregator={aggregator}
      team={team}
      me={{ adminId: me?.adminId ?? "", role: me?.role ?? "" }}
    />
  );
}
