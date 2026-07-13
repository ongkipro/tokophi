"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Plus, LifeBuoy, ChevronRight } from "lucide-react";
import { createTicket } from "@/lib/actions/support";
import type { TicketRow } from "@/lib/data/support";
import { useCan } from "@/components/admin/permissions";
import { timeAgo } from "@/lib/format";
import { TicketStatus } from "./ticket-status";

export function BantuanClient({ tickets }: { tickets: TicketRow[] }) {
  const router = useRouter();
  const canWrite = useCan("support:write");
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  const submit = () =>
    start(async () => {
      const r = await createTicket(subject, body);
      if (r.ok && r.id) { setOpen(false); setSubject(""); setBody(""); toast.success("Tiket dibuat."); router.push(`/bantuan/${r.id}`); }
      else toast.error(r.error ?? "Gagal membuat tiket.");
    });

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="gap-1.5"><Plus className="size-4" /> Tiket baru</Button>} />
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>Buat tiket bantuan</DialogTitle></DialogHeader>
              <div className="flex flex-col gap-4 py-2">
                <div className="flex flex-col gap-2"><Label htmlFor="t-subject">Subjek</Label><Input id="t-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ringkas masalah Anda" /></div>
                <div className="flex flex-col gap-2"><Label htmlFor="t-body">Pesan</Label><Textarea id="t-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Jelaskan detailnya…" /></div>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline">Batal</Button>} />
                <Button disabled={pending || !subject.trim() || !body.trim()} onClick={submit}>{pending ? "Mengirim…" : "Kirim"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <LifeBuoy className="size-8" />
              <p className="text-sm">Belum ada tiket. Buat tiket bila butuh bantuan.</p>
            </div>
          ) : (
            tickets.map((t, i) => (
              <Link key={t.id} href={`/bantuan/${t.id}`} className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 ${i > 0 ? "border-t" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.subject}</div>
                  <div className="text-xs text-muted-foreground">Diperbarui {timeAgo(t.minutesAgo)}</div>
                </div>
                <TicketStatus status={t.status} />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
