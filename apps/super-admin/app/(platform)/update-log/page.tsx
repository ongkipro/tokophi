import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { UpdateLogClient } from "./update-log-client";

export const metadata = {
  title: "Update Log Development | Super Admin TokoΦ",
  description: "Histori perbaikan bug, rilis minor & mayor, serta log teknis khusus operator human.",
};

export default async function UpdateLogPage() {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/update-log");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  return <UpdateLogClient />;
}
