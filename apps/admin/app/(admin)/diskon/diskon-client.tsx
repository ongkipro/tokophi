"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Copy,
  Check,
  Percent,
  Tag,
  Truck,
  MoreHorizontal,
  Pencil,
  PauseCircle,
  Trash2,
  Ticket,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR, num } from "@tokophi/lib/format";
import { useCan } from "@/components/admin/permissions";
import { toast } from "sonner";
import { deleteDiscount } from "@/lib/actions/discounts";
import { ConfirmDelete } from "@/components/admin/confirm-delete";
import { type Discount, type DiscountType } from "@/lib/mock/store";

import { Card, CardContent } from "@tokophi/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
import { Progress } from "@tokophi/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@tokophi/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tokophi/ui/dropdown-menu";

// ---- presentation helpers ----
type StatusKey = Discount["status"];

const TYPE_META: Record<DiscountType, { label: string; icon: React.ElementType }> = {
  persen: { label: "Persentase", icon: Percent },
  nominal: { label: "Potongan", icon: Tag },
  ongkir: { label: "Gratis Ongkir", icon: Truck },
};

const STATUS_META: Record<StatusKey, { label: string; className: string }> = {
  aktif: {
    label: "Aktif",
    className:
      "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  terjadwal: {
    label: "Terjadwal",
    className:
      "bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  },
  habis: {
    label: "Kuota habis",
    className: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  },
  nonaktif: {
    label: "Nonaktif",
    className: "bg-ink/10 text-muted-foreground",
  },
  kadaluarsa: {
    label: "Kadaluarsa",
    className: "bg-muted text-muted-foreground",
  },
};

function discountValueLabel(d: Discount): string {
  if (d.type === "persen") return `${d.value}%`;
  if (d.type === "nominal") return IDR(d.value);
  return "Gratis Ongkir";
}

function endsLabel(days: number | null): { text: string; muted: boolean } {
  // `null` = `ends_at IS NULL` = no end date at all. It is NOT `0`, which means "ends today" — the
  // two used to collapse, so a voucher that never expires was announced as expiring within the hour.
  if (days === null) return { text: "Tanpa batas waktu", muted: true };
  if (days > 0) return { text: `${days} hari lagi`, muted: false };
  if (days === 0) return { text: "Berakhir hari ini", muted: false };
  return { text: "Berakhir", muted: true };
}

// `estimateSaving()` is GONE. Its own comment said "Fabricated": it multiplied `used_count` by a
// hardcoded AVG_ORDER = 200.000 and rendered ≈Rp90,3jt for a store whose real `sum(discount_idr)` is
// **0**, over 0 discounted orders. The number now comes from the orders table (`getDiscountSavings`).

const FILTERS: { key: "semua" | StatusKey; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "aktif", label: "Aktif" },
  { key: "terjadwal", label: "Terjadwal" },
  { key: "kadaluarsa", label: "Kadaluarsa" },
];

// ---- small components ----
function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Salin kode ${code}`}
      className="text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        try {
          navigator.clipboard?.writeText(code);
        } catch {
          /* noop */
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="text-emerald-500" /> : <Copy />}
    </Button>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-2xl font-bold tracking-tight tabular-nums">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}

function TypeBadge({ type }: { type: DiscountType }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className="gap-1 font-normal">
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: StatusKey }) {
  const meta = STATUS_META[status];
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

function UsageCell({ used, limit }: { used: number; limit: number }) {
  const value = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="flex w-40 flex-col gap-1.5">
      <Progress value={value} className="w-full" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {num(used)} / {num(limit)}
      </span>
    </div>
  );
}

function RowActions({ id }: { id: string }) {
  const canWrite = useCan("discounts:write");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const del = () =>
    start(async () => {
      try {
        await deleteDiscount(id);
        toast.success("Diskon dihapus.");
        router.refresh();
      } catch {
        toast.error("Gagal menghapus — coba lagi.");
      } finally {
        setConfirmOpen(false);
      }
    });
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Aksi diskon">
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem render={<Link href={`/diskon/${id}`} />}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        {/* Nonaktifkan: the list's status is derived from the dates, not the DB status column, so
            setting status='nonaktif' would be invisible — needs read-layer + storefront work first. */}
        {canWrite && (
          <DropdownMenuItem disabled className="opacity-60">
            <PauseCircle />
            Nonaktifkan
            <span className="ml-auto text-[10px] text-muted-foreground">segera</span>
          </DropdownMenuItem>
        )}
        {canWrite && <DropdownMenuSeparator />}
        {canWrite && (
          <DropdownMenuItem variant="destructive" disabled={pending} onClick={() => setConfirmOpen(true)}>
            <Trash2 />
            Hapus
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    {/* `deleteDiscount` hard-deletes the row AND its `discount_usages` trail; `orders.discount_idr`
        on past orders is untouched, which is what the copy promises. */}
    <ConfirmDelete
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="Hapus diskon?"
      description="Kode ini beserta riwayat pemakaiannya dihapus permanen dan tidak bisa dikembalikan. Pesanan yang sudah memakainya tidak berubah."
      onConfirm={del}
      pending={pending}
    />
    </>
  );
}

// ---- page ----
/** `savings` = Σ orders.discount_idr — the real rupiah customers were given, not an estimate. */
export function DiskonClient({ discounts, savings }: { discounts: Discount[]; savings: number }) {
  const router = useRouter();
  const canWrite = useCan("discounts:write");
  const [filter, setFilter] = React.useState<"semua" | StatusKey>("semua");

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {
      semua: discounts.length,
      aktif: 0,
      terjadwal: 0,
      kadaluarsa: 0,
    };
    for (const d of discounts) c[d.status]++;
    return c;
  }, [discounts]);

  // ⚠️ `discounts` in EVERY dependency list. It was missing from all four, and `router.refresh()`
  // re-renders with new props WITHOUT remounting — so nothing recomputed: a deleted voucher stayed in
  // the table under a "Diskon dihapus." toast, and the three KPI tiles never moved.
  const totalUsed = React.useMemo(
    () => discounts.reduce((s, d) => s + d.used, 0),
    [discounts],
  );

  const rows = React.useMemo(
    () => (filter === "semua" ? discounts : discounts.filter((d) => d.status === filter)),
    [filter, discounts],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Diskon" desc="Kelola kode promo dan diskon otomatis.">
        {canWrite && (
          <Button nativeButton={false} render={<Link href="/diskon/baru" />}>
            <Plus />
            Buat Diskon
          </Button>
        )}
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Diskon Aktif"
          value={num(counts.aktif)}
          hint={`dari ${num(discounts.length)} total kode`}
        />
        <StatCard
          label="Total Penggunaan"
          value={num(totalUsed)}
          hint="redemption sepanjang periode"
        />
        <StatCard
          label="Penghematan Pelanggan"
          value={IDR(savings, { compact: true })}
          hint="dari orders.discount_idr — nilai yang benar-benar dipotong"
        />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        {/* Each filter carries a count, so the strip measured 372px and overflowed a 360px phone —
            the most common Android (audit:responsive). It scrolls rather than squeezes. */}
        <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.key} value={f.key} className="gap-1.5">
                {f.label}
                <span className="rounded bg-foreground/10 px-1 text-xs tabular-nums text-muted-foreground">
                  {num(counts[f.key])}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value={filter}>
          <Card className="py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Kode</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Nilai</TableHead>
                    <TableHead>Penggunaan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Berakhir</TableHead>
                    <TableHead className="w-10 pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => {
                    const ends = endsLabel(d.endsInDays);
                    return (
                      <TableRow
                        key={d.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/diskon/${d.id}`)}
                      >
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-sm font-bold">{d.code}</span>
                            <CopyButton code={d.code} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <TypeBadge type={d.type} />
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {discountValueLabel(d)}
                        </TableCell>
                        <TableCell>
                          <UsageCell used={d.used} limit={d.limit} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={d.status} />
                        </TableCell>
                        <TableCell
                          className={
                            ends.muted
                              ? "text-sm text-muted-foreground"
                              : "text-sm tabular-nums"
                          }
                        >
                          {ends.text}
                        </TableCell>
                        <TableCell
                          className="pr-4 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <RowActions id={d.id} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <div className="flex flex-col items-center gap-2 py-10 text-center">
                          <Ticket className="size-6 text-muted-foreground" />
                          {/* "pada kategori ini" points at a tab. A store with zero discounts is not
                              on the wrong tab — it has never made one. */}
                          {discounts.length === 0 ? (
                            <>
                              <p className="text-sm font-medium">Belum ada diskon</p>
                              <p className="text-sm text-muted-foreground">
                                Buat kode promo pertama untuk mendorong pembeli menyelesaikan checkout.
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Tidak ada diskon pada kategori ini.
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
