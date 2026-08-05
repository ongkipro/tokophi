"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Store as StoreIcon,
  HeartPulse,
  AlertTriangle,
  CircleAlert,
  Search,
  ChevronDown,
  MoreHorizontal,
  Eye,
  ExternalLink,
  Ban,
  Play,
  Plus,
  Crown,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { cn } from "@tokophi/ui/lib/utils";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@tokophi/ui/dialog";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@tokophi/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@tokophi/ui/dropdown-menu";

import { type Store } from "@/lib/types";
import { type HealthVerdict } from "@/lib/health-types";
import { initials, StatusBadge, HealthBadge, SegmentBadge } from "@/components/bits";
import { SEGMENT_META, type StoreSegment } from "@tokophi/lib/billing";
import { impersonateStore, liftSuspension, createStore, setStoreComped } from "@/lib/actions";
import { refused } from "@/lib/refused";
import { IDR, num } from "@tokophi/lib/format";

type StatusFilter = "semua" | Store["status"];
type HealthFilter = "semua" | HealthVerdict;
type SegmentTab = "semua" | StoreSegment;

// The 4 lifecycle "sessions" the store list is split into (+ an "all" tab).
const SEGMENT_TABS: { key: SegmentTab; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "trial", label: "Trial" },
  { key: "first_month", label: SEGMENT_META.first_month.short },
  { key: "regular", label: SEGMENT_META.regular.short },
  { key: "vip", label: "VIP" },
];

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "semua", label: "Semua status" },
  { key: "aktif", label: "Aktif" },
  { key: "trial", label: "Trial" },
  { key: "menunggak", label: "Menunggak" },
  { key: "ditangguhkan", label: "Ditangguhkan" },
];

const HEALTH_OPTIONS: { key: HealthFilter; label: string }[] = [
  { key: "semua", label: "Semua kesehatan" },
  { key: "sehat", label: "Sehat" },
  { key: "perhatian", label: "Perhatian" },
  { key: "bermasalah", label: "Bermasalah" },
];

export function TokoClient({
  stores,
  healthById,
}: {
  stores: Store[];
  healthById: Record<string, HealthVerdict>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<SegmentTab>("semua");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("semua");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("semua");

  // create-store (provisioning) dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [nsName, setNsName] = useState("");
  const [nsOwner, setNsOwner] = useState("");
  const [nsEmail, setNsEmail] = useState("");
  const [nsCity, setNsCity] = useState("");

  const verdictOf = (id: string): HealthVerdict => healthById[id] ?? "sehat";

  const stats = useMemo(() => {
    const by = (v: HealthVerdict) => stores.filter((s) => verdictOf(s.id) === v).length;
    return [
      { label: "Total toko", value: stores.length, icon: StoreIcon, tint: "bg-muted text-muted-foreground" },
      { label: "Sehat", value: by("sehat"), icon: HeartPulse, tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
      { label: "Perhatian", value: by("perhatian"), icon: AlertTriangle, tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
      { label: "Bermasalah", value: by("bermasalah"), icon: CircleAlert, tint: "bg-destructive/12 text-destructive" },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, healthById]);

  const segmentCount = (seg: SegmentTab) => (seg === "semua" ? stores.length : stores.filter((s) => s.segment === seg).length);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((s) => {
      if (segment !== "semua" && s.segment !== segment) return false;
      if (statusFilter !== "semua" && s.status !== statusFilter) return false;
      if (healthFilter !== "semua" && verdictOf(s.id) !== healthFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.owner.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, query, segment, statusFilter, healthFilter, healthById]);

  const statusLabel = STATUS_OPTIONS.find((o) => o.key === statusFilter)!.label;
  const healthLabel = HEALTH_OPTIONS.find((o) => o.key === healthFilter)!.label;

  function openAdmin(s: Store) {
    startTransition(async () => {
      const r = await impersonateStore(s.id);
      if (r.ok && r.adminUrl) {
        toast.success(`Membuka Dashboard Seller “${s.name}”…`);
        window.open(r.adminUrl, "_blank", "noopener");
      } else {
        toast.error(r.error ?? "Gagal membuka Dashboard Seller.");
      }
    });
  }

  // Lifting needs no input, so it stays a one-click action here. SUSPENDING does — the reason is
  // mandatory and is shown to the merchant — so this menu only offers it where it can be collected:
  // the store detail (see the `Tangguhkan…` link below). A row menu that cannot ask for the reason
  // must not pretend it can.
  //
  // The toast is whatever the action reports having WRITTEN, never a string chosen here: lifting a
  // suspension on a store that is also unpaid leaves it read-only, and "Toko diaktifkan." was a lie
  // in exactly that case.
  function liftSuspend(s: Store) {
    startTransition(async () => {
      const r = await liftSuspension(s.id);
      if (!r.ok) { toast.error(r.error ?? "Gagal mencabut penangguhan."); return; }
      toast.success(r.message!);
      router.refresh();
    });
  }

  function toggleVip(s: Store) {
    startTransition(async () => {
      const no = refused(await setStoreComped(s.id, !s.comped, s.comped ? undefined : `${s.orders30d} pesanan/30 hari — dibebaskan platform`));
      if (no) return void toast.error(no);
      toast.success(s.comped ? `“${s.name}” kembali berbayar.` : `“${s.name}” dijadikan VIP (gratis).`);
      router.refresh();
    });
  }

  function submitCreate() {
    startTransition(async () => {
      const r = await createStore({ name: nsName, ownerName: nsOwner, email: nsEmail, city: nsCity });
      if (r.ok && r.storeId) {
        // The owner's password is random and shown ONCE — it is not stored anywhere readable and
        // there is no "resend" (only a reset, from the store detail). We navigate to the store right
        // after, so this must NOT be a dialog on this screen: the toast lives in the root layout and
        // survives the push, and it stays until dismissed. Same hand-over as `invitePlatformAdmin`.
        toast.success(`Toko “${nsName}” dibuat.`, {
          description: r.password
            ? `Login pemilik: ${nsEmail} · password sementara: ${r.password} — salin sekarang, tidak bisa dilihat lagi.`
            : undefined,
          duration: Infinity,
          closeButton: true,
        });
        setCreateOpen(false);
        setNsName(""); setNsOwner(""); setNsEmail(""); setNsCity("");
        router.push(`/toko/${r.storeId}`);
      } else {
        toast.error(r.error ?? "Gagal membuat toko.");
      }
    });
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Toko</h1>
  
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button className="gap-1.5"><Plus className="size-4" /> Tambah toko</Button>} />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Tambah toko baru</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ns-name">Nama toko</Label>
                <Input id="ns-name" value={nsName} onChange={(e) => setNsName(e.target.value)} placeholder="mis. Kopi Senja" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ns-owner">Nama pemilik</Label>
                  <Input id="ns-owner" value={nsOwner} onChange={(e) => setNsOwner(e.target.value)} placeholder="Nama owner" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ns-city">Kota</Label>
                  <Input id="ns-city" value={nsCity} onChange={(e) => setNsCity(e.target.value)} placeholder="mis. Bandung" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ns-email">Email pemilik</Label>
                <Input id="ns-email" type="email" value={nsEmail} onChange={(e) => setNsEmail(e.target.value)} placeholder="owner@toko.id" />
              </div>
              <p className="text-xs text-muted-foreground">Toko baru mulai <span className="font-medium">Trial 3 hari</span> paket TokoΦ. Password pemilik dibuat <span className="font-medium">acak</span> dan hanya ditampilkan sekali setelah toko dibuat — salin lalu berikan ke pemilik.</p>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Batal</Button>} />
              <Button disabled={pending || !nsName || !nsEmail} onClick={submitCreate}>{pending ? "Membuat…" : "Buat toko"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
              <span className={`flex size-8 items-center justify-center rounded-lg ${s.tint}`}>
                <s.icon className="size-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{num(s.value)}</div>
          </Card>
        ))}
      </div>

      <Card className="gap-0 py-0">
        {/* segment tabs (the 4 sessions) */}
        <div className="flex flex-wrap gap-1 border-b p-2">
          {SEGMENT_TABS.map((t) => {
            const active = segment === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSegment(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t.key === "vip" && <Crown className="size-3.5" />}
                {t.label}
                <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-primary/15" : "bg-muted")}>{segmentCount(t.key)}</span>
              </button>
            );
          })}
        </div>

        {/* toolbar */}
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama, owner, atau email…" className="pl-8" />
          </div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5">{healthLabel}<ChevronDown className="size-4 text-muted-foreground" /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Filter kesehatan</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {HEALTH_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.key} onClick={() => setHealthFilter(o.key)}>{o.label}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5">{statusLabel}<ChevronDown className="size-4 text-muted-foreground" /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Filter status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {STATUS_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.key} onClick={() => setStatusFilter(o.key)}>{o.label}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Toko</TableHead>
                <TableHead>Tahap</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Kesehatan</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="text-right">Pesanan (30h)</TableHead>
                <TableHead className="hidden text-right md:table-cell">Total pesanan</TableHead>
                <TableHead className="hidden md:table-cell">Order terakhir</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id} onClick={() => router.push(`/toko/${s.id}`)} className="cursor-pointer">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">{initials(s.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{s.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{s.owner} · {s.city}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><SegmentBadge segment={s.segment} /></TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell><HealthBadge verdict={verdictOf(s.id)} /></TableCell>
                  <TableCell className="text-right tabular-nums">{IDR(s.gmv, { compact: true })}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={cn(s.orders30d === 0 && "text-muted-foreground")}>{num(s.orders30d)}</span>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{num(s.orders)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">
                    {s.lastOrderDays == null ? (
                      <span className="text-xs text-muted-foreground">Belum pernah</span>
                    ) : (
                      <span className={cn("inline-flex items-center gap-1 text-xs tabular-nums", s.lastOrderDays >= 30 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>
                        <Clock className="size-3.5" />{s.lastOrderDays} hari lalu
                      </span>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Aksi ${s.name}`} />}>
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem render={<Link href={`/toko/${s.id}`} />}>
                          <Eye className="size-4" /> Lihat & kontrol
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={pending} onClick={() => openAdmin(s)}>
                          <ExternalLink className="size-4" /> Buka Dashboard Seller
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={pending} onClick={() => toggleVip(s)}>
                          <Crown className="size-4" /> {s.comped ? "Cabut VIP" : "Jadikan VIP (gratis)"}
                        </DropdownMenuItem>
                        {s.operatorSuspended ? (
                          <DropdownMenuItem disabled={pending} onClick={() => liftSuspend(s)}>
                            <Play className="size-4" /> Cabut penangguhan
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem variant="destructive" render={<Link href={`/toko/${s.id}`} />}>
                            <Ban className="size-4" /> Tangguhkan…
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">Tidak ada toko yang cocok.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t px-4 py-3 text-xs text-muted-foreground">{num(filtered.length)} toko</div>
      </Card>
    </div>
  );
}
