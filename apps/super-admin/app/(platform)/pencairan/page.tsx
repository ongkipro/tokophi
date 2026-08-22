import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { getPayouts, getPayoutSummary, getPayoutPolicy } from "@/lib/data";
import { PencairanClient } from "./pencairan-client";

export const dynamic = "force-dynamic";

export default async function PencairanPage() {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/pencairan");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const [payouts, summary, policy] = await Promise.all([getPayouts(), getPayoutSummary(), getPayoutPolicy()]);
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pencairan</h1>
        <p className="text-sm text-muted-foreground">
          Permintaan tarik saldo dari semua toko. Saldo merchant sudah dipotong sejak permintaan dibuat —{" "}
          <span className="font-medium text-foreground">menolak akan mengembalikannya</span>.
        </p>
      </div>
      <PencairanClient payouts={payouts} summary={summary} policy={policy} />
    </div>
  );
}
