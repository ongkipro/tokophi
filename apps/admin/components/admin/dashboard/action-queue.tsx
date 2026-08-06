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
        {/* Same figure group as `kpi-tile.tsx`: leading-none on the number, then 4px to the lines
            that name it. It was 2px twice — a micro-step that exists nowhere else on the dashboard,
            so five tiles that sit directly above the KPI cards were keeping a different rhythm from
            them. 4px is the scale's "inside a group" step; the three type sizes (24/14/12) are what
            separate the roles, not a spacing value nothing else uses. */}
        <div className={cn("text-2xl leading-none font-bold tabular-nums", clear && "text-muted-foreground")}>
          {clear ? "Beres" : num(item.count)}
        </div>
        {/* line-clamp-2, NOT truncate: in the 2-column mobile grid a single line is ~18 characters, so
            `truncate` cut the tiles down to "pesanan siap dipros…" and "Ulasan perlu diti…" — a label
            you cannot finish reading is not a label. Two lines fit every current string; the clamp is
            still there so a future long one degrades instead of shoving the tile. */}
        <div className="mt-1 line-clamp-2 text-sm font-medium">{item.label}</div>
        {/* The hint carries figures ("sisa < 20 unit", amounts) under a count that is already
            tabular; without this the two lines of one tile disagreed. */}
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground/75 tabular-nums">{clear ? item.done : item.hint}</div>
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
        {/* tabular-nums: the total drops as the seller works through the queue, and this line sits
            directly above the counts it sums. Measured 1440px, 2026-08-06: the sentence re-flowed by
            10,4px between an all-1 and an all-8 total, so the words after the number walked. */}
        <CardDescription className="tabular-nums">
          {total === 0
            ? "Semua beres — tidak ada yang perlu dikerjakan sekarang."
            : `${num(total)} hal perlu ditindaklanjuti sekarang.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 5 tiles in 2 mobile columns = 2+2+1, and the orphan left a dead half-row. If the last tile
            lands in an odd slot it spans the row instead — the grid ends flush. Only bites on the
            2-col breakpoint; md/xl divide evenly. */}
        <div className="grid grid-cols-2 gap-3 [&>a:last-child:nth-child(odd)]:col-span-2 md:grid-cols-3 md:[&>a:last-child:nth-child(odd)]:col-span-1 xl:grid-cols-5">
          {items.map((i) => <Tile key={i.key} item={i} />)}
        </div>

        {stuck.orders > 0 && (
          <Link
            href="/pesanan"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm tabular-nums transition-colors hover:bg-amber-500/[0.12]"
          >
            <span className="font-semibold text-amber-700 dark:text-amber-400">
              {IDR(stuck.value)}
            </span>
            {/* The rupiah figure was already tabular; the order COUNT beside it was not, and it moves
                on the same events. Measured 1440px, 2026-08-06: 10,4px of re-flow in this sentence.
                The class is on the row now, so a number added to either half inherits it. */}
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
