"use client";

import * as React from "react";
import {
  Plus, MoreHorizontal, Eye, PackageCheck, XCircle,
  ClipboardList, Wallet, Truck, PackageOpen,
} from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { IDR, num } from "@/lib/format";
import { PURCHASE_ORDERS, type PurchaseOrder, type POStatus } from "@/lib/mock/store";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// ---- status presentation ----
const STATUS_META: Record<POStatus, { label: string; className: string }> = {
  draft: {
    label: "Draf",
    className: "bg-muted text-muted-foreground",
  },
  dipesan: {
    label: "Dipesan",
    className: "border-transparent bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  },
  sebagian: {
    label: "Diterima sebagian",
    className: "border-transparent bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  },
  diterima: {
    label: "Diterima",
    className: "border-transparent bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
};

function StatusBadge({ status }: { status: POStatus }) {
  const m = STATUS_META[status];
  return <Badge className={m.className}>{m.label}</Badge>;
}

function etaLabel(days: number): { text: string; muted: boolean } {
  if (days > 0) return { text: `${num(days)} hari lagi`, muted: false };
  if (days === 0) return { text: "Hari ini", muted: false };
  return { text: "Tiba", muted: true };
}

// ---- filter tabs ----
type TabKey = "semua" | POStatus;
const TABS: { key: TabKey; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "draft", label: "Draft" },
  { key: "dipesan", label: "Dipesan" },
  { key: "sebagian", label: "Sebagian" },
  { key: "diterima", label: "Diterima" },
];

function StatCard({ icon, label, value, accent, hint }: {
  icon: React.ReactNode; label: string; value: string; accent: string; hint?: string;
}) {
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", accent)}>{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums tracking-tight">{value}</p>
          {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function RowActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi pesanan" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem><Eye /> Lihat</DropdownMenuItem>
        <DropdownMenuItem><PackageCheck /> Tandai diterima</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><XCircle /> Batalkan</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CreateOrderDialog() {
  const [supplier, setSupplier] = React.useState("");
  const [items, setItems] = React.useState("");
  const [eta, setEta] = React.useState("");
  const [note, setNote] = React.useState("");

  return (
    <Dialog>
      <DialogTrigger render={<Button><Plus /> Buat pesanan pembelian</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buat pesanan pembelian</DialogTitle>
          <DialogDescription>
            Pesan stok baru ke pemasok. Draf dapat diubah sebelum dikirim.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-2">
            <Label htmlFor="po-supplier">Pemasok</Label>
            <Input id="po-supplier" placeholder="mis. CV Sumber Rejeki" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="po-items">Jumlah item</Label>
              <Input id="po-items" type="number" min={1} inputMode="numeric" placeholder="0" value={items} onChange={(e) => setItems(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="po-eta">Estimasi tiba</Label>
              <Input id="po-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="po-note">Catatan</Label>
            <Textarea id="po-note" rows={3} placeholder="Catatan untuk pemasok (opsional)…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <DialogClose render={<Button>Buat</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Page() {
  const [tab, setTab] = React.useState<TabKey>("semua");

  const counts = React.useMemo(() => {
    const c: Record<TabKey, number> = { semua: PURCHASE_ORDERS.length, draft: 0, dipesan: 0, sebagian: 0, diterima: 0 };
    for (const po of PURCHASE_ORDERS) c[po.status] += 1;
    return c;
  }, []);

  const stats = React.useMemo(() => {
    const aktif = PURCHASE_ORDERS.filter((p) => p.status !== "diterima").length;
    const nilaiDipesan = PURCHASE_ORDERS.filter((p) => p.status !== "diterima").reduce((s, p) => s + p.total, 0);
    const tibaMingguIni = PURCHASE_ORDERS.filter((p) => p.etaDays >= 0 && p.etaDays <= 7).length;
    return { aktif, nilaiDipesan, tibaMingguIni };
  }, []);

  const filtered = React.useMemo(
    () => (tab === "semua" ? PURCHASE_ORDERS : PURCHASE_ORDERS.filter((p) => p.status === tab)),
    [tab],
  );

  return (
    <div>
      <PageHeader title="Pembelian" desc="Kelola pesanan pembelian stok ke pemasok.">
        <CreateOrderDialog />
      </PageHeader>

      {/* Stat cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<ClipboardList className="size-4" />}
          label="Pesanan aktif"
          value={num(stats.aktif)}
          hint="Draf, dipesan & sebagian"
          accent="bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400"
        />
        <StatCard
          icon={<Wallet className="size-4" />}
          label="Nilai dipesan"
          value={IDR(stats.nilaiDipesan, { compact: true })}
          hint="Belum diterima"
          accent="bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"
        />
        <StatCard
          icon={<Truck className="size-4" />}
          label="Akan tiba minggu ini"
          value={num(stats.tibaMingguIni)}
          hint="Estimasi 0–7 hari"
          accent="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
        />
      </div>

      {/* Status tabs */}
      <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card className="py-0">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <PackageOpen className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Tidak ada pesanan pembelian</p>
            <p className="text-sm text-muted-foreground">Belum ada pesanan dengan status ini.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>No. PO</TableHead>
                <TableHead>Pemasok</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden md:table-cell">Estimasi tiba</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Dibuat</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((po) => {
                const eta = etaLabel(po.etaDays);
                return (
                  <TableRow key={po.id} className="cursor-pointer">
                    <TableCell className="font-mono text-xs font-medium tabular-nums">{po.id}</TableCell>
                    <TableCell className="font-medium">{po.supplier}</TableCell>
                    <TableCell><StatusBadge status={po.status} /></TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{num(po.items)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{IDR(po.total)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className={cn("text-sm tabular-nums", eta.muted && "text-muted-foreground")}>{eta.text}</span>
                    </TableCell>
                    <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground lg:table-cell">{num(po.createdDaysAgo)} hari lalu</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}><RowActions /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Footer count */}
      <p className="mt-3 text-xs text-muted-foreground">{num(filtered.length)} pesanan pembelian</p>
    </div>
  );
}
