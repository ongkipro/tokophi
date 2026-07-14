import { redirect } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { canReadChat, getThread, getThreads } from "@/lib/data/chat";
import { ObrolanClient } from "./obrolan-client";

export const dynamic = "force-dynamic";

// Obrolan — the merchant's shopper-chat inbox (specs/docs/CHAT_SPEC.md §5b).
// `chat:read` is guarded HERE, on the route, not just on the sidebar item: hiding a nav row is not
// access control (spec §6).
export default async function ObrolanPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (!(await canReadChat())) redirect("/");

  const { id } = await searchParams;
  const threads = await getThreads();
  const selectedId = id && threads.some((t) => t.id === id) ? id : threads[0]?.id;
  const thread = selectedId ? await getThread(selectedId) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Obrolan" desc="Pesan dari pembeli di toko online — balas langsung dari sini." />
      <ObrolanClient threads={threads} thread={thread} />
    </div>
  );
}
