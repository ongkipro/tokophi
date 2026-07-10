"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { LifeBuoy, ChevronRight } from "lucide-react";
import { Card } from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { cn } from "@tokophi/ui/lib/utils";
import type { PTicket } from "@/lib/data";

// Platform-facing labels: "open" = a merchant is waiting on us.
export const TICKET_UI: Record<string, { label: string; cls: string }> = {
  open: { label: "Perlu dibalas", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  answered: { label: "Dibalas", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  closed: { label: "Selesai", cls: "bg-muted text-muted-foreground" },
};
const ago = (m: number) => (m < 60 ? `${m} mnt lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`);

const TABS: { key: "semua" | "open" | "answered" | "closed"; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "open", label: "Perlu dibalas" },
  { key: "answered", label: "Dibalas" },
  { key: "closed", label: "Selesai" },
];

export function TiketClient({ tickets }: { tickets: PTicket[] }) {
  const [tab, setTab] = useState<"semua" | "open" | "answered" | "closed">("semua");
  const count = (k: string) => (k === "semua" ? tickets.length : tickets.filter((t) => t.status === k).length);
  const rows = useMemo(() => (tab === "semua" ? tickets : tickets.filter((t) => t.status === tab)), [tab, tickets]);

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap gap-1 border-b p-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", tab === t.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
            {t.label}<span className={cn("rounded-full px-1.5 text-xs tabular-nums", tab === t.key ? "bg-primary/15" : "bg-muted")}>{count(t.key)}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground"><LifeBuoy className="size-8" /><p className="text-sm">Tidak ada tiket.</p></div>
      ) : (
        rows.map((t, i) => (
          <Link key={t.id} href={`/tiket/${t.id}`} className={cn("flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40", i > 0 && "border-t")}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.subject}</div>
              <div className="text-xs text-muted-foreground">{t.storeName} · {ago(t.minutesAgo)}</div>
            </div>
            <Badge variant="secondary" className={cn("border-transparent", TICKET_UI[t.status]?.cls)}>{TICKET_UI[t.status]?.label ?? t.status}</Badge>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))
      )}
    </Card>
  );
}
