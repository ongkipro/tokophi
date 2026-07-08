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
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Input } from "@tokophi/ui/input";
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

import { type Plan, type Store } from "@/lib/mock";
import { type HealthVerdict } from "@/lib/health-types";
import { initials, PlanBadge, StatusBadge, HealthBadge } from "@/components/bits";
import { impersonateStore, setStoreStatus } from "@/lib/actions";
import { IDR, num } from "@tokophi/lib/format";

type PlanFilter = "semua" | Plan;
type StatusFilter = "semua" | Store["status"];
type HealthFilter = "semua" | HealthVerdict;

const PLAN_OPTIONS: { key: PlanFilter; label: string }[] = [
  { key: "semua", label: "Semua paket" },
  { key: "pemula", label: "Pemula" },
  { key: "bisnis", label: "Bisnis" },
  { key: "skala", label: "Skala" },
];

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "semua", label: "Semua status" },
  { key: "aktif", label: "Aktif" },
  { key: "trial", label: "Trial" },
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
  const [planFilter, setPlanFilter] = useState<PlanFilter>("semua");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("semua");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("semua");

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((s) => {
      if (planFilter !== "semua" && s.plan !== planFilter) return false;
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
  }, [stores, query, planFilter, statusFilter, healthFilter, healthById]);

  const planLabel = PLAN_OPTIONS.find((o) => o.key === planFilter)!.label;
  const statusLabel = STATUS_OPTIONS.find((o) => o.key === statusFilter)!.label;
  const healthLabel = HEALTH_OPTIONS.find((o) => o.key === healthFilter)!.label;

  function openAdmin(s: Store) {
    startTransition(async () => {
      const r = await impersonateStore(s.id);
      if (r.ok && r.adminUrl) {
        toast.success(`Membuka panel admin “${s.name}”…`);
        window.open(r.adminUrl, "_blank", "noopener");
      } else {
        toast.error(r.error ?? "Gagal membuka panel admin.");
      }
    });
  }

  function toggleSuspend(s: Store) {
    const next = s.status === "ditangguhkan" ? "active" : "suspended";
    startTransition(async () => {
      await setStoreStatus(s.id, next);
      toast.success(next === "suspended" ? `Toko “${s.name}” ditangguhkan.` : `Toko “${s.name}” diaktifkan.`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Toko</h1>
        <p className="text-sm text-muted-foreground">
          Semua toko merchant di platform — status langganan &amp; kesehatan operasional.
        </p>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {s.label}
              </span>
              <span className={`flex size-8 items-center justify-center rounded-lg ${s.tint}`}>
                <s.icon className="size-4" />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tracking-tight tabular-nums">
              {num(s.value)}
            </div>
          </Card>
        ))}
      </div>

      <Card className="gap-0 py-0">
        {/* toolbar */}
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama, owner, atau email…"
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="gap-1.5">
                    {healthLabel}
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Filter kesehatan</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {HEALTH_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.key} onClick={() => setHealthFilter(o.key)}>
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="gap-1.5">
                    {planLabel}
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Filter paket</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {PLAN_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.key} onClick={() => setPlanFilter(o.key)}>
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="gap-1.5">
                    {statusLabel}
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Filter status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {STATUS_OPTIONS.map((o) => (
                  <DropdownMenuItem key={o.key} onClick={() => setStatusFilter(o.key)}>
                    {o.label}
                  </DropdownMenuItem>
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
                <TableHead>Owner</TableHead>
                <TableHead>Paket</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Kesehatan</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  Pesanan
                </TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow
                  key={s.id}
                  onClick={() => router.push(`/toko/${s.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
                          {initials(s.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{s.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.city}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate">{s.owner}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {s.email}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <PlanBadge plan={s.plan} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell>
                    <HealthBadge verdict={verdictOf(s.id)} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {IDR(s.gmv, { compact: true })}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {num(s.orders)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {s.createdDaysAgo} hari lalu
                  </TableCell>
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                    className="text-right"
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Aksi ${s.name}`}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem render={<Link href={`/toko/${s.id}`} />}>
                          <Eye className="size-4" /> Lihat detail
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={pending} onClick={() => openAdmin(s)}>
                          <ExternalLink className="size-4" /> Buka panel admin
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {s.status === "ditangguhkan" ? (
                          <DropdownMenuItem disabled={pending} onClick={() => toggleSuspend(s)}>
                            <Play className="size-4" /> Aktifkan
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem variant="destructive" disabled={pending} onClick={() => toggleSuspend(s)}>
                            <Ban className="size-4" /> Tangguhkan
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Tidak ada toko yang cocok.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t px-4 py-3 text-xs text-muted-foreground">
          {num(filtered.length)} toko
        </div>
      </Card>
    </div>
  );
}
