"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Store as StoreIcon,
  CircleCheck,
  Clock,
  Ban,
  Search,
  ChevronDown,
  MoreHorizontal,
  Eye,
  LogIn,
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@indostore/ui/card";
import { Button } from "@indostore/ui/button";
import { Input } from "@indostore/ui/input";
import { Avatar, AvatarFallback } from "@indostore/ui/avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@indostore/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@indostore/ui/dropdown-menu";

import { STORES, type Plan, type Store } from "@/lib/mock";
import { initials, PlanBadge, StatusBadge } from "@/components/bits";
import { IDR, num } from "@indostore/lib/format";

type PlanFilter = "semua" | Plan;
type StatusFilter = "semua" | Store["status"];

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

export default function TokoPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("semua");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("semua");

  const stats = useMemo(
    () => [
      { label: "Total toko", value: STORES.length, icon: StoreIcon },
      {
        label: "Aktif",
        value: STORES.filter((s) => s.status === "aktif").length,
        icon: CircleCheck,
      },
      {
        label: "Trial",
        value: STORES.filter((s) => s.status === "trial").length,
        icon: Clock,
      },
      {
        label: "Ditangguhkan",
        value: STORES.filter((s) => s.status === "ditangguhkan").length,
        icon: Ban,
      },
    ],
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STORES.filter((s) => {
      if (planFilter !== "semua" && s.plan !== planFilter) return false;
      if (statusFilter !== "semua" && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.owner.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
      );
    });
  }, [query, planFilter, statusFilter]);

  const planLabel = PLAN_OPTIONS.find((o) => o.key === planFilter)!.label;
  const statusLabel = STATUS_OPTIONS.find((o) => o.key === statusFilter)!.label;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Toko</h1>
        <p className="text-sm text-muted-foreground">
          Semua toko merchant di platform.
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
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
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
          <div className="flex gap-2">
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
                  <DropdownMenuItem
                    key={o.key}
                    onClick={() => setPlanFilter(o.key)}
                  >
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
                  <DropdownMenuItem
                    key={o.key}
                    onClick={() => setStatusFilter(o.key)}
                  >
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
                        <DropdownMenuItem
                          onClick={() =>
                            toast.success("Masuk sebagai " + s.name)
                          }
                        >
                          <LogIn className="size-4" /> Impersonasi
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            toast(`Toko "${s.name}" ditangguhkan.`)
                          }
                        >
                          <Ban className="size-4" /> Tangguhkan
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
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
