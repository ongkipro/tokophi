import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { getPaymentGateways, getCouriers, getAggregator, getPlatformAdmins, getPaymentChannels } from "@/lib/data";
import { PengaturanClient } from "./pengaturan-client";

export const dynamic = "force-dynamic";

export default async function PengaturanPage() {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/pengaturan");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const [gateways, couriers, channels, aggregator, team] = await Promise.all([
    getPaymentGateways(),
    getCouriers(),
    getPaymentChannels(),
    getAggregator(),
    getPlatformAdmins(),
  ]);
  // Who is looking — ONLY to decide whether the owner-only affordance is drawn. The boundary is
  // `platformGate("owner")` inside the action; this is so an `admin` operator is not offered a
  // button that can only ever refuse. It comes from the route gate above, which re-read
  // `platform_admins` on this request (never from the cookie's claims) — one lookup, not two.
  const me = gate.admin;
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
