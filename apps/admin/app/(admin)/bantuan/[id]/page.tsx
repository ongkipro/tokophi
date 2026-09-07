import { notFound } from "next/navigation";
import { isUuid } from "@/lib/uuid";
import { getTicket } from "@/lib/data/support";
import { ThreadClient } from "./thread-client";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-UUID segment reaches `eq(x.id, id)` and Postgres THROWS 22P02 — a 500 where a 404 belongs.
  // `/produk/…` takes the catalog NUMBER, so merchants do try `/<this route>/1042`. See @tokophi/lib/uuid.
  if (!isUuid(id)) notFound();
  const ticket = await getTicket(id);
  if (!ticket) notFound();
  return <ThreadClient ticket={ticket} />;
}
