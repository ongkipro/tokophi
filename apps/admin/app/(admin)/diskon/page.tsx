"use client";

import * as React from "react";
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
  Dice5,
  ChevronDown,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR, num } from "@/lib/format";
import { DISCOUNTS, type Discount, type DiscountType } from "@/lib/mock/store";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

const TYPE_OPTIONS: { value: DiscountType; label: string }[] = [
  { value: "persen", label: "Persentase" },
  { value: "nominal", label: "Potongan Nominal" },
  { value: "ongkir", label: "Gratis Ongkir" },
];

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
      onClick={() => {
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

function RowActions() {
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
        <DropdownMenuItem>
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

// ---- create dialog ----
function randomCode() {
  const words = ["HEMAT", "PROMO", "GAJIAN", "FLASH", "SPESIAL", "MERDEKA"];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}${Math.floor(10 + Math.random() * 89)}`;
}

function CreateDiscountDialog() {
  const [code, setCode] = React.useState("");
  const [type, setType] = React.useState<DiscountType>("persen");
  const typeLabel =
    TYPE_OPTIONS.find((o) => o.value === type)?.label ?? "Persentase";

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button>
            <Plus />
            Buat Diskon
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buat Diskon</DialogTitle>
          <DialogDescription>
            Buat kode promo baru untuk pelanggan Anda.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-2">
            <Label htmlFor="kode">Kode diskon</Label>
            <div className="flex items-center gap-2">
              <Input
                id="kode"
                placeholder="mis. GAJIAN25"
                className="font-mono uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setCode(randomCode())}
              >
                <Dice5 />
                Buat acak
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Tipe diskon</Label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="justify-between font-normal">
                    {typeLabel}
                    <ChevronDown className="text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent className="w-(--anchor-width)">
                {TYPE_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.value} onClick={() => setType(o.value)}>
                    {o.value === type ? (
                      <Check className="text-emerald-500" />
                    ) : (
                      <span className="size-4" />
                    )}
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nilai">Nilai</Label>
              <Input
                id="nilai"
                inputMode="numeric"
                placeholder={type === "persen" ? "25" : "50000"}
                disabled={type === "ongkir"}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="batas">Batas penggunaan</Label>
              <Input id="batas" inputMode="numeric" placeholder="1000" />
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <Label htmlFor="aktifkan">Aktifkan sekarang</Label>
              <span className="text-xs text-muted-foreground">
                Diskon langsung dapat digunakan pelanggan.
              </span>
            </div>
            <Switch id="aktifkan" defaultChecked />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <DialogClose render={<Button>Simpan</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- page ----
export default function Page() {
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
        <CreateDiscountDialog />
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
                      <TableRow key={d.id}>
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
                        <TableCell className="pr-4 text-right">
                          <RowActions />
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
