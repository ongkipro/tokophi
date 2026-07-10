import { notFound } from "next/navigation";
import { getTicketAdmin } from "@/lib/data";
import { ThreadClient } from "./thread-client";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await getTicketAdmin(id);
  if (!ticket) notFound();
  return <ThreadClient ticket={ticket} />;
}
