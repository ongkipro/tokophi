"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, Send, CheckCheck } from "lucide-react";
import { replyTicket, closeTicket, type TicketDetail } from "@/lib/actions/support";
import { TicketStatus } from "../ticket-status";
import { cn } from "@/lib/utils";

const time = (d: Date) => new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ThreadClient({ ticket }: { ticket: TicketDetail }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [body, setBody] = React.useState("");
  const closed = ticket.status === "closed";

  const send = () =>
    start(async () => {
      const r = await replyTicket(ticket.id, body);
      if (r.ok) { setBody(""); router.refresh(); } else toast.error(r.error ?? "Gagal mengirim.");
    });
  const close = () => start(async () => { await closeTicket(ticket.id); toast.success("Tiket ditutup."); router.refresh(); });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href="/bantuan" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Bantuan</Link>
        {!closed && <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={pending} onClick={close}><CheckCheck className="size-4" /> Tandai selesai</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">{ticket.subject}</h1>
        <TicketStatus status={ticket.status} />
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          {ticket.messages.map((m) => {
            const mine = m.sender === "merchant";
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  <div className={cn("mb-0.5 text-[11px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{mine ? "Anda" : "TokoΦ Support"} · {time(m.createdAt)}</div>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {closed ? (
        <p className="text-center text-sm text-muted-foreground">Tiket ini sudah ditutup.</p>
      ) : (
        <div className="flex items-end gap-2">
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Tulis balasan…" className="min-h-11 flex-1" />
          <Button className="gap-1.5" disabled={pending || !body.trim()} onClick={send}><Send className="size-4" /> Kirim</Button>
        </div>
      )}
    </div>
  );
}
