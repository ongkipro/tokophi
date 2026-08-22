import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { getStores } from "@/lib/data";
import { getHealthMap } from "@/lib/health";
import type { HealthVerdict } from "@/lib/health-types";
import { TokoClient } from "./toko-client";

export const dynamic = "force-dynamic";

export default async function TokoPage() {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/toko");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const [stores, healthMap] = await Promise.all([getStores(), getHealthMap()]);
  const healthById: Record<string, HealthVerdict> = {};
  for (const s of stores) healthById[s.id] = healthMap.get(s.id)?.verdict ?? "sehat";
  return <TokoClient stores={stores} healthById={healthById} />;
}
