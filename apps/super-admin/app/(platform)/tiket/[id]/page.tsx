import { platformRouteGate } from "@/lib/platform-auth";
import { RouteDenied } from "@/components/route-denied";
import { notFound } from "next/navigation";
import { getTicketAdmin } from "@/lib/data";
import { ThreadClient } from "./thread-client";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  // SEC-9: the rank floor for this route group, BEFORE a single privileged read.
  // `platformGate(min)` inside each action stays the mutation boundary; this is additive.
  const gate = await platformRouteGate("/tiket");
  if (!gate.ok) return <RouteDenied need={gate.need} role={gate.role} reason={gate.reason} landing={gate.landing} />;

  const { id } = await params;
  const ticket = await getTicketAdmin(id);
  if (!ticket) notFound();
  return <ThreadClient ticket={ticket} />;
}
