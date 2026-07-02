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
import { IDR, num } from "@/lib/format";
import { DISCOUNTS, type Discount, type DiscountType } from "@/lib/mock/store";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function endsLabel(days: number): { text: string; muted: boolean } {
  if (days > 0) return { text: `${days} hari lagi`, muted: false };
  if (days === 0) return { text: "Berakhir hari ini", muted: false };
  return { text: "Berakhir", muted: true };
}

// Fabricated "penghematan pelanggan" estimate per redemption.
function estimateSaving(d: Discount): number {
  const AVG_ORDER = 200_000;
  const AVG_SHIPPING = 22_000;
  const per =
    d.type === "persen"
      ? (AVG_ORDER * d.value) / 100
      : d.type === "nominal"
        ? d.value
        : AVG_SHIPPING;
  return per * d.used;
}

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
  return (
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
        <DropdownMenuItem>
          <PauseCircle />
          Nonaktifkan
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 />
          Hapus
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---- page ----
export default function Page() {
  const router = useRouter();
  const [filter, setFilter] = React.useState<"semua" | StatusKey>("semua");

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {
      semua: DISCOUNTS.length,
      aktif: 0,
      terjadwal: 0,
      kadaluarsa: 0,
    };
    for (const d of DISCOUNTS) c[d.status]++;
    return c;
  }, []);

  const totalUsed = React.useMemo(
    () => DISCOUNTS.reduce((s, d) => s + d.used, 0),
    [],
  );
  const totalSaving = React.useMemo(
    () => DISCOUNTS.reduce((s, d) => s + estimateSaving(d), 0),
    [],
  );

  const rows = React.useMemo(
    () => (filter === "semua" ? DISCOUNTS : DISCOUNTS.filter((d) => d.status === filter)),
    [filter],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Diskon" desc="Kelola kode promo dan diskon otomatis.">
        <Button nativeButton={false} render={<Link href="/diskon/baru" />}>
          <Plus />
          Buat Diskon
        </Button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Diskon Aktif"
          value={num(counts.aktif)}
          hint={`dari ${num(DISCOUNTS.length)} total kode`}
        />
        <StatCard
          label="Total Penggunaan"
          value={num(totalUsed)}
          hint="redemption sepanjang periode"
        />
        <StatCard
          label="Estimasi Penghematan Pelanggan"
          value={IDR(totalSaving, { compact: true })}
          hint="perkiraan nilai diskon yang dinikmati"
        />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList className="mb-4">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.key} value={f.key} className="gap-1.5">
              {f.label}
              <span className="rounded bg-foreground/10 px-1 text-xs tabular-nums text-muted-foreground">
                {num(counts[f.key])}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

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
                          <p className="text-sm text-muted-foreground">
                            Tidak ada diskon pada kategori ini.
                          </p>
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
