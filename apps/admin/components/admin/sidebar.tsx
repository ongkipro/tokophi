import Link from "next/link";
import { NavLinks } from "./nav-links";
import { Brand } from "./brand";
import { Sparkles } from "lucide-react";
import { getBilling } from "@/lib/data/billing";

const STATUS_UI: Record<string, { label: string; dot: string; accent: string }> = {
  trial: { label: "Uji coba", dot: "bg-amber-500", accent: "border-amber-500/30 bg-amber-500/5" },
  active: { label: "Aktif", dot: "bg-emerald-500", accent: "border-primary/20 bg-primary/5" },
  past_due: { label: "Menunggu bayar", dot: "bg-orange-500", accent: "border-orange-500/40 bg-orange-500/5" },
  suspended: { label: "Ditangguhkan", dot: "bg-destructive", accent: "border-destructive/40 bg-destructive/5" },
};

export async function Sidebar() {
  const bill = await getBilling();
  const ui = STATUS_UI[bill?.status ?? "active"];
  const label = bill?.comped ? "VIP · gratis" : ui.label;
  const days = bill && !bill.comped && bill.status !== "suspended" ? `${bill.daysLeft}h` : null;
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
      <div className="flex h-16 items-center border-b px-5">
        <Brand />
      </div>
      {/* subscription badge — fixed right under the logo so it never shifts with nav clicks */}
      <div className="border-b px-3 py-2.5">
        <Link
          href="/akun/langganan"
          className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-muted/50 ${bill?.comped ? "border-violet-500/30 bg-violet-500/5" : ui.accent}`}
        >
          <span className="flex items-center gap-1.5 font-medium"><Sparkles className="size-3.5 text-primary" /> Langganan</span>
          <span className="flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${bill?.comped ? "bg-violet-500" : ui.dot}`} />
            <span className="text-muted-foreground">{label}{days ? ` · ${days}` : ""}</span>
          </span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <NavLinks />
      </div>
    </aside>
  );
}
