"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, Send, CheckCheck, RotateCcw, Store } from "lucide-react";
import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Textarea } from "@tokophi/ui/textarea";
import { cn } from "@tokophi/ui/lib/utils";
import { replyTicketAdmin, setTicketStatus } from "@/lib/actions";
import { refused } from "@/lib/refused";
import type { PTicketDetail } from "@/lib/data";
import { TICKET_UI } from "../tiket-client";

const time = (d: Date) => new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ThreadClient({ ticket }: { ticket: PTicketDetail }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const closed = ticket.status === "closed";

  const send = () => start(async () => {
    const r = await replyTicketAdmin(ticket.id, body);
    if (r.ok) { setBody(""); toast.success("Balasan terkirim."); router.refresh(); } else toast.error(r.error ?? "Gagal.");
  });
  const setStatus = (s: "open" | "closed") => start(async () => {
    const no = refused(await setTicketStatus(ticket.id, s));
    if (no) return void toast.error(no);
    toast.success(s === "closed" ? "Tiket ditutup." : "Tiket dibuka lagi.");
    router.refresh();
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href="/tiket" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Tiket</Link>
        {closed
          ? <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={pending} onClick={() => setStatus("open")}><RotateCcw className="size-4" /> Buka lagi</Button>
          : <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={pending} onClick={() => setStatus("closed")}><CheckCheck className="size-4" /> Tutup tiket</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">{ticket.subject}</h1>
        <Badge variant="secondary" className={cn("border-transparent", TICKET_UI[ticket.status]?.cls)}>{TICKET_UI[ticket.status]?.label ?? ticket.status}</Badge>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Store className="size-3.5" /> {ticket.storeName}</span>
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          {ticket.messages.map((m) => {
            const platform = m.sender === "platform";
            return (
              <div key={m.id} className={cn("flex", platform ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", platform ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  <div className={cn("mb-0.5 text-[11px]", platform ? "text-primary-foreground/70" : "text-muted-foreground")}>{platform ? "Anda (TokoΦ)" : ticket.storeName} · {time(m.createdAt)}</div>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {closed ? (
        <p className="text-center text-sm text-muted-foreground">Tiket ditutup. Buka lagi untuk membalas.</p>
      ) : (
        <div className="flex items-end gap-2">
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Balas ke merchant…" className="min-h-11 flex-1" />
          <Button className="gap-1.5" disabled={pending || !body.trim()} onClick={send}><Send className="size-4" /> Kirim</Button>
        </div>
      )}
    </div>
  );
}
