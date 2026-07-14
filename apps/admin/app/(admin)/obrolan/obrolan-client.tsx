"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { MessageSquare, Package, ShoppingBag, User } from "lucide-react";
import { cn } from "@tokophi/ui/lib/utils";
import { useCan } from "@/components/admin/permissions";
import { Composer, Thread } from "@/components/admin/obrolan/thread";
import { markThreadRead, pollChat } from "@/lib/actions/chat";
import type { ChatMessage, ChatThread, ChatThreadRow } from "@/lib/data/chat";
import { sendReply } from "@/lib/actions/chat";

// Polling: 5s focused / 30s blurred, and it patches state — NO router.refresh(), which would
// re-render the whole RSC tree every 5 seconds (spec §5b).
const FOCUSED_MS = 5_000;
const BLURRED_MS = 30_000;

const ago = (m: number) => (m < 1 ? "baru saja" : m < 60 ? `${m} mnt` : m < 1440 ? `${Math.floor(m / 60)} jam` : `${Math.floor(m / 1440)} hr`);

const STATUS_LABEL: Record<string, string> = { open: "Terbuka", snoozed: "Ditunda", closed: "Selesai" };
const SENDER_LABEL = { merchant: "Anda", customer: "Pembeli", system: "Sistem" };

const newestOf = (rows: { lastMessageAt: string }[], seed: string | null = null) =>
  rows.reduce<string | null>((max, r) => (!max || r.lastMessageAt > max ? r.lastMessageAt : max), seed);

export function ObrolanClient({ threads: initialThreads, thread: initialThread }: { threads: ChatThreadRow[]; thread: ChatThread | null }) {
  const router = useRouter();
  const canWrite = useCan("chat:write");
  const selected = initialThread; // the server owns "which thread" (?id=…); state only owns the delta
  const selectedId = selected?.id ?? null;

  const [threads, setThreads] = React.useState(initialThreads);
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialThread?.messages ?? []);
  const [pending, setPending] = React.useState(false);

  // Navigating to another thread hands us fresh props → re-derive DURING RENDER (the sanctioned
  // React pattern) rather than in an effect, which would cascade a second render on every switch.
  const [syncedId, setSyncedId] = React.useState<string | null>(null);
  if (syncedId !== selectedId) {
    setSyncedId(selectedId);
    setMessages(initialThread?.messages ?? []);
    setThreads(initialThreads.map((t) => (t.id === selectedId ? { ...t, unread: 0 } : t)));
  }

  // Opening a thread clears its badge server-side. An effect is right here: it pushes state OUT to
  // an external system (the DB), it doesn't set React state.
  React.useEffect(() => {
    if (selectedId) void markThreadRead(selectedId);
  }, [selectedId]);

  // ---- the poll loop --------------------------------------------------------------------------
  // The cursors live INSIDE the effect: they are the loop's own bookkeeping, not render state, and
  // the effect is re-created (with fresh props) whenever the merchant switches thread. A message
  // sent from this tab may therefore come back once on the next poll — the id de-dupe below drops
  // it, and the cursor then moves past it.
  React.useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const seeded = initialThread?.id === selectedId ? (initialThread?.messages ?? []) : [];
    const last = seeded[seeded.length - 1];
    let cursor: string | null = last ? `${last.createdAt},${last.id}` : null;
    let inboxSince: string | null = newestOf(initialThreads);

    const tick = async () => {
      try {
        const d = await pollChat({ conversationId: selectedId, since: cursor, inboxSince });
        if (stop) return;
        if (d.messages.length) {
          cursor = d.cursor;
          setMessages((prev) => {
            const have = new Set(prev.map((m) => m.id));
            return [...prev, ...d.messages.filter((m) => !have.has(m.id))];
          });
          // We are looking at the thread → a new shopper message is read on arrival.
          if (selectedId && d.messages.some((m) => m.sender === "customer")) void markThreadRead(selectedId);
        }
        if (d.threads.length) {
          // Delta merge: only the threads that moved came back.
          setThreads((prev) => {
            const byId = new Map(prev.map((t) => [t.id, t]));
            for (const t of d.threads) byId.set(t.id, t.id === selectedId ? { ...t, unread: 0 } : t);
            return [...byId.values()].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
          });
          inboxSince = newestOf(d.threads, inboxSince);
        }
      } catch {
        /* a failed poll is a no-op — the next tick retries */
      } finally {
        if (!stop) timer = setTimeout(tick, document.visibilityState === "visible" ? FOCUSED_MS : BLURRED_MS);
      }
    };

    timer = setTimeout(tick, FOCUSED_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // props only SEED the loop; a new object identity on every RSC render must not restart polling.
    // The thread id is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const open = (id: string) => {
    if (id === selectedId) return;
    router.push(`/obrolan?id=${id}`, { scroll: false });
  };

  const send = (body: string) => {
    if (!selectedId) return;
    setPending(true);
    void sendReply(selectedId, body)
      .then((r) => {
        if (!r.ok || !r.message) {
          toast.error(r.error ?? "Gagal mengirim.");
          return;
        }
        const m = r.message;
        setMessages((prev) => [...prev, m]);
        setThreads((prev) =>
          prev
            .map((t) => (t.id === selectedId ? { ...t, preview: m.body.slice(0, 140), unread: 0, minutesAgo: 0, lastMessageAt: m.createdAt } : t))
            .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1)),
        );
      })
      .finally(() => setPending(false));
  };

  const totalUnread = threads.reduce((s, t) => s + t.unread, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      {/* List */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">Percakapan</p>
            {totalUnread > 0 && <Badge>{totalUnread} baru</Badge>}
          </div>
          {threads.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Belum ada obrolan dari pembeli.</p>
          ) : (
            <ul className="max-h-[32rem] divide-y overflow-y-auto">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => open(t.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/60",
                      t.id === selectedId && "bg-muted",
                    )}
                  >
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {(t.visitorName ?? "T").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{t.visitorName ?? "Tamu"}</span>
                        {t.isCustomer && <User className="size-3 shrink-0 text-muted-foreground" />}
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{ago(t.minutesAgo)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="truncate text-xs text-muted-foreground">{t.preview ?? "—"}</span>
                        {t.unread > 0 && <span className="ml-auto size-2 shrink-0 rounded-full bg-primary" aria-label={`${t.unread} belum dibaca`} />}
                      </span>
                      {t.status !== "open" && (
                        <span className="mt-1 inline-block text-[10px] text-muted-foreground">{STATUS_LABEL[t.status]}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Thread */}
      <Card className="flex flex-col">
        {!selected ? (
          <CardContent className="grid flex-1 place-items-center py-16 text-center text-sm text-muted-foreground">
            <span className="space-y-2">
              <MessageSquare className="mx-auto size-6" />
              <span className="block">Pilih percakapan untuk membalas.</span>
            </span>
          </CardContent>
        ) : (
          <CardContent className="flex flex-1 flex-col gap-4 py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-3">
              <p className="text-sm font-semibold">{selected.visitorName ?? "Tamu"}</p>
              {selected.visitorPhone && <span className="text-xs text-muted-foreground">{selected.visitorPhone}</span>}
              {selected.productHandle && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Package className="size-3.5" /> {selected.productHandle}
                </span>
              )}
              {selected.orderNumber && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ShoppingBag className="size-3.5" /> {selected.orderNumber}
                </span>
              )}
              <Badge variant="secondary" className="ml-auto">{STATUS_LABEL[selected.status]}</Badge>
            </div>

            <div className="min-h-[18rem] flex-1 overflow-y-auto">
              <Thread messages={messages} mineSender="merchant" labels={SENDER_LABEL} />
            </div>

            {canWrite ? (
              <Composer onSend={send} pending={pending} />
            ) : (
              <p className="text-center text-sm text-muted-foreground">Peran Anda tidak dapat membalas obrolan.</p>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
