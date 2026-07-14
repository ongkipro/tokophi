import Link from "next/link";
import { ArrowRight, Check, Truck, ShoppingBag, PackageX, Star, LifeBuoy, type LucideIcon } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@tokophi/ui/card";
import { cn } from "@tokophi/ui/lib/utils";
import { IDR, num } from "@tokophi/lib/format";
import type { QueueItem, QueueTone, StuckMoney } from "@/lib/data/dashboard";

const ICON: Record<string, LucideIcon> = {
  dikirim: Truck,
  baru: ShoppingBag,
  stok: PackageX,
  ulasan: Star,
  tiket: LifeBuoy,
};

const TONE: Record<QueueTone, string> = {
  urgent: "bg-destructive/10 text-destructive",
  warn: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  info: "bg-primary/12 text-primary",
};

function Tile({ item }: { item: QueueItem }) {
  const Icon = ICON[item.key] ?? ShoppingBag;
  const clear = item.count === 0;
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border p-4 transition-colors",
        clear ? "bg-muted/30 hover:bg-muted/60" : "hover:border-primary/40 hover:bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "grid size-8 place-items-center rounded-lg",
            clear ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : TONE[item.tone],
          )}
        >
          {clear ? <Check className="size-4" /> : <Icon className="size-4" />}
        </span>
        <ArrowRight className="size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </div>
      <div>
        <div className={cn("text-2xl font-bold tabular-nums", clear && "text-muted-foreground")}>
          {clear ? "Beres" : num(item.count)}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium">{item.label}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{clear ? item.done : item.hint}</div>
      </div>
    </Link>
  );
}

export function ActionQueue({ items, stuck }: { items: QueueItem[]; stuck: StuckMoney }) {
  const total = items.reduce((a, i) => a + i.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Antrian Kerja</CardTitle>
        <CardDescription>
          {total === 0
            ? "Semua beres — tidak ada yang perlu dikerjakan sekarang."
            : `${num(total)} hal perlu ditindaklanjuti sekarang.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {items.map((i) => <Tile key={i.key} item={i} />)}
        </div>

        {stuck.orders > 0 && (
          <Link
            href="/pesanan"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm transition-colors hover:bg-amber-500/[0.12]"
          >
            <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {IDR(stuck.value)}
            </span>
            <span className="text-muted-foreground">
              tertahan di {num(stuck.orders)} pesanan yang belum dikirim — kirim untuk mencairkannya.
            </span>
            <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
