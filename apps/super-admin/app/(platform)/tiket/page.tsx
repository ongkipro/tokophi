import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { getAllTickets } from "@/lib/data";
import { TiketClient } from "./tiket-client";

export const dynamic = "force-dynamic";

export default async function TiketPage() {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/tiket");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const tickets = await getAllTickets();
  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tiket Support</h1>
        <p className="text-sm text-muted-foreground">Semua tiket bantuan dari merchant. Balas &amp; tutup di sini.</p>
      </div>
      <TiketClient tickets={tickets} />
    </div>
  );
}
