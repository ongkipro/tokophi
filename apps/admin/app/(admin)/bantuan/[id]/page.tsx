import { notFound } from "next/navigation";
import { getTicket } from "@/lib/data/support";
import { ThreadClient } from "./thread-client";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await getTicket(id);
  if (!ticket) notFound();
  return <ThreadClient ticket={ticket} />;
}
