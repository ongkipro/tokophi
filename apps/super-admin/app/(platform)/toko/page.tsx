import { getStores } from "@/lib/data";
import { getHealthMap } from "@/lib/health";
import type { HealthVerdict } from "@/lib/health-types";
import { TokoClient } from "./toko-client";

export const dynamic = "force-dynamic";

export default async function TokoPage() {
  const [stores, healthMap] = await Promise.all([getStores(), getHealthMap()]);
  const healthById: Record<string, HealthVerdict> = {};
  for (const s of stores) healthById[s.id] = healthMap.get(s.id)?.verdict ?? "sehat";
  return <TokoClient stores={stores} healthById={healthById} />;
}
