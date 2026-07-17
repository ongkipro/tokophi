"use client";

import * as React from "react";
import {
  Plus, MoreHorizontal, Eye, PackageCheck, XCircle,
  ClipboardList, Wallet, Truck, PackageOpen, ChevronDown, Trash2,
} from "lucide-react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/page-header";
import { IDR, num } from "@tokophi/lib/format";
import { type PurchaseOrder, type POStatus } from "@/lib/mock/store";
import { type POProduct } from "@/lib/data/purchases";
import { createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder } from "@/lib/actions/purchases";
import { useCan } from "@/components/admin/permissions";
import { cn } from "@tokophi/ui/lib/utils";

import { Card, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@tokophi/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";

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

function RowActions({ po }: { po: PurchaseOrder }) {
  const router = useRouter();
  const canWrite = useCan("purchases:write");
  const [pending, startTransition] = React.useTransition();
  const receive = () =>
    startTransition(async () => {
      try {
        await receivePurchaseOrder(po.id);
        toast.success(`${po.id} diterima — stok diperbarui`);
        router.refresh();
      } catch {
        toast.error("Gagal menerima pesanan");
      }
    });
  const cancel = () =>
    startTransition(async () => {
      try {
        await cancelPurchaseOrder(po.id);
        toast.success(`${po.id} dibatalkan`);
        router.refresh();
      } catch {
        toast.error("Gagal membatalkan pesanan");
      }
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Aksi pesanan" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {/* No PO detail route/query exists — honest disabled rather than a no-op click. */}
        <DropdownMenuItem disabled className="opacity-60"><Eye /> Lihat<span className="ml-auto text-[10px] text-muted-foreground">segera</span></DropdownMenuItem>
        {canWrite && <DropdownMenuItem disabled={pending || po.status === "diterima"} onClick={receive}><PackageCheck /> Tandai diterima</DropdownMenuItem>}
        {canWrite && <DropdownMenuSeparator />}
        {canWrite && <DropdownMenuItem variant="destructive" disabled={pending} onClick={cancel}><XCircle /> Batalkan</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Line = { variantId: string; qty: number; cost: number };

function CreateOrderDialog({ products }: { products: POProduct[] }) {
  const router = useRouter();
  const canWrite = useCan("purchases:write");
  const [open, setOpen] = React.useState(false);
  const [supplier, setSupplier] = React.useState("");
  const [eta, setEta] = React.useState("");
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [pending, startTransition] = React.useTransition();

  const addLine = () => setLines((l) => [...l, { variantId: "", qty: 1, cost: 0 }]);
  const setLine = (i: number, patch: Partial<Line>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeLine = (i: number) => setLines((l) => l.filter((_, j) => j !== i));
  const nameOf = (vid: string) => products.find((p) => p.variantId === vid)?.name ?? "Pilih produk";
  const total = lines.reduce((a, l) => a + l.qty * l.cost, 0);
  const reset = () => { setSupplier(""); setEta(""); setNote(""); setLines([]); };

  const create = () => {
    if (!supplier.trim()) { toast.error("Pemasok wajib diisi"); return; }
    const valid = lines.filter((l) => l.variantId && l.qty > 0);
    if (!valid.length) { toast.error("Tambah minimal 1 item"); return; }
    startTransition(async () => {
      try {
        await createPurchaseOrder({ supplier, etaDate: eta, note, lines: valid });
        toast.success("Pesanan pembelian dibuat");
        setOpen(false);
        reset();
        router.refresh();
      } catch {
        toast.error("Gagal membuat pesanan");
      }
    });
  };

  if (!canWrite) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><Plus /> Buat pesanan pembelian</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat pesanan pembelian</DialogTitle>
          <DialogDescription>
            Pesan stok baru ke pemasok. &ldquo;Terima barang&rdquo; nanti menambah stok otomatis.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="po-supplier">Pemasok</Label>
              <Input id="po-supplier" placeholder="mis. CV Sumber Rejeki" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="po-eta">Estimasi tiba</Label>
              <Input id="po-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Item</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="size-3.5" /> Tambah item</Button>
            </div>
            {lines.length === 0 && (
              <p className="text-xs text-muted-foreground">Belum ada item — klik &ldquo;Tambah item&rdquo;.</p>
            )}
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="min-w-0 flex-1 justify-between font-normal" />}>
                    <span className="truncate">{nameOf(l.variantId)}</span>
                    <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                    {products.map((p) => (
                      <DropdownMenuItem key={p.variantId} onClick={() => setLine(i, { variantId: p.variantId, cost: l.cost || Math.round(p.price * 0.6) })}>
                        {p.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Input aria-label="Jumlah" type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: parseInt(e.target.value) || 0 })} className="w-16 text-center" />
                <Input aria-label="HPP" type="number" min={0} value={l.cost} onChange={(e) => setLine(i, { cost: parseInt(e.target.value) || 0 })} className="w-24 text-right tabular-nums" />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Hapus item" onClick={() => removeLine(i)}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            {lines.length > 0 && (
              <div className="flex justify-between border-t pt-2 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold tabular-nums">{IDR(total)}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="po-note">Catatan</Label>
            <Textarea id="po-note" rows={2} placeholder="Catatan untuk pemasok (opsional)…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Batal</Button>} />
          <Button onClick={create} disabled={pending}>{pending ? "Membuat…" : "Buat"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PembelianClient({ orders, products }: { orders: PurchaseOrder[]; products: POProduct[] }) {
  const [tab, setTab] = React.useState<TabKey>("semua");

  const counts = React.useMemo(() => {
    const c: Record<TabKey, number> = { semua: orders.length, draft: 0, dipesan: 0, sebagian: 0, diterima: 0 };
    for (const po of orders) c[po.status] += 1;
    return c;
  }, []);

  const stats = React.useMemo(() => {
    const aktif = orders.filter((p) => p.status !== "diterima").length;
    const nilaiDipesan = orders.filter((p) => p.status !== "diterima").reduce((s, p) => s + p.total, 0);
    const tibaMingguIni = orders.filter((p) => p.etaDays >= 0 && p.etaDays <= 7).length;
    return { aktif, nilaiDipesan, tibaMingguIni };
  }, []);

  const filtered = React.useMemo(
    () => (tab === "semua" ? orders : orders.filter((p) => p.status === tab)),
    [tab],
  );

  return (
    <div>
      <PageHeader title="Pembelian" desc="Kelola pesanan pembelian stok ke pemasok.">
        <CreateOrderDialog products={products} />
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
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}><RowActions po={po} /></TableCell>
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
