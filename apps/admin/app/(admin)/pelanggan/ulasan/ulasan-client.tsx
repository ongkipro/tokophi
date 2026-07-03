"use client";

import { useMemo, useState } from "react";
import {
  Star,
  MoreHorizontal,
  Check,
  EyeOff,
  MessageSquare,
  Search,
  Trash2,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { type Review, type ReviewStatus } from "@/lib/mock/store";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

// Render a 1..5 rating as filled/empty stars.
function Stars({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      aria-label={`${rating} dari 5 bintang`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "size-3.5",
            i < rating
              ? "fill-amber-400 text-amber-400"
              : "fill-transparent text-muted-foreground/30",
          )}
        />
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  if (status === "terbit") {
    return (
      <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Check className="size-3!" /> Terbit
      </Badge>
    );
  }
  return (
    <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400">
      <Clock className="size-3!" /> Menunggu
    </Badge>
  );
}

type TabKey = "semua" | ReviewStatus;

const STATUS_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "semua", label: "Semua" },
  { key: "terbit", label: "Terbit" },
  { key: "menunggu", label: "Menunggu" },
];

export function UlasanClient({ reviews }: { reviews: Review[] }) {
  const [tab, setTab] = useState<TabKey>("semua");
  const [query, setQuery] = useState("");

  const avg =
    reviews.reduce((a, r) => a + r.rating, 0) / Math.max(1, reviews.length);
  const avgLabel = avg.toFixed(1).replace(".", ",");
  const menungguCount = reviews.filter((r) => r.status === "menunggu").length;

  const counts = useMemo(() => {
    return {
      semua: reviews.length,
      terbit: reviews.filter((r) => r.status === "terbit").length,
      menunggu: menungguCount,
    } satisfies Record<TabKey, number>;
  }, [menungguCount]);

  const rows = useMemo(() => {
    let list = reviews.slice();
    if (tab !== "semua") list = list.filter((r) => r.status === tab);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.customer.toLowerCase().includes(q) ||
          r.product.toLowerCase().includes(q) ||
          r.text.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tab, query]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader
        title="Ulasan"
        desc="Kelola ulasan produk dari pelanggan Anda."
      />

      {/* stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="gap-0 p-5">
          <span className="text-sm font-medium text-muted-foreground">
            Rating rata-rata
          </span>
          <div className="mt-3 flex items-end gap-2.5">
            <span className="text-2xl font-bold tracking-tight tabular-nums">
              {avgLabel}
            </span>
            <Stars rating={Math.round(avg)} className="mb-1.5" />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            dari {num(reviews.length)} ulasan
          </div>
        </Card>

        <Card className="gap-0 p-5">
          <span className="text-sm font-medium text-muted-foreground">
            Total ulasan
          </span>
          <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
            {num(reviews.length)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            seluruh produk
          </div>
        </Card>

        <Card className="gap-0 p-5">
          <span className="text-sm font-medium text-muted-foreground">
            Menunggu moderasi
          </span>
          <div className="mt-3 text-2xl font-bold tracking-tight text-amber-600 tabular-nums dark:text-amber-400">
            {num(menungguCount)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            perlu ditinjau
          </div>
        </Card>
      </div>

      <Card className="gap-0 py-0">
        {/* tabs + search */}
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                  {t.label}
                  <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {counts[t.key]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari pelanggan, produk, atau isi ulasan…"
              className="h-8 w-full pl-8 lg:w-72"
            />
          </div>
        </div>

        <Separator />

        {/* review list */}
        <div>
          {rows.map((r, i) => (
            <div key={r.id}>
              {i > 0 && <Separator />}
              <ReviewRow review={r} />
            </div>
          ))}
          {rows.length === 0 && (
            <div className="py-14 text-center text-sm text-muted-foreground">
              Tidak ada ulasan yang cocok.
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <>
            <Separator />
            <div className="p-4 text-xs text-muted-foreground">
              Menampilkan {num(rows.length)} ulasan
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function ReviewRow({ review: r }: { review: Review }) {
  return (
    <div className="flex gap-4 p-4 sm:p-5">
      {/* product emoji tile */}
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
        {r.emoji}
      </div>

      {/* main */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium">{r.customer}</div>
            <div className="truncate text-xs text-muted-foreground">
              membeli {r.product}
            </div>
          </div>

          {/* right meta */}
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={r.status} />
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {num(r.daysAgo)} hari lalu
            </span>
            <ReviewActions status={r.status} />
          </div>
        </div>

        <div className="mt-2">
          <Stars rating={r.rating} />
        </div>

        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {r.text}
        </p>

        <span className="mt-2 block text-xs text-muted-foreground tabular-nums sm:hidden">
          {num(r.daysAgo)} hari lalu
        </span>
      </div>
    </div>
  );
}

function ReviewActions({ status }: { status: ReviewStatus }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Aksi ulasan">
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {status === "menunggu" ? (
          <DropdownMenuItem>
            <Check className="size-4" /> Terbitkan
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem>
            <EyeOff className="size-4" /> Sembunyikan
          </DropdownMenuItem>
        )}
        <DropdownMenuItem>
          <MessageSquare className="size-4" /> Balas
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 className="size-4" /> Hapus
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
