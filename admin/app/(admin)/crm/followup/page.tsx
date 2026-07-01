"use client";

import { useMemo, useState } from "react";
import {
  Send,
  MoreHorizontal,
  Check,
  ShoppingCart,
  CreditCard,
  PackageCheck,
  Star,
  Repeat,
  MessageCircle,
  Search,
  Clock,
  AlertTriangle,
  Eye,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  FOLLOWUPS,
  WA_TEMPLATES,
  type Followup,
  type FollowupType,
  type FollowupStatus,
} from "@/lib/mock/store";
import { num, waLink, fillTemplate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TOKO = "Batik Nusantara";

// ---- helpers ----
function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type TypeMeta = { label: string; Icon: LucideIcon; badgeClass: string };
function typeMeta(type: FollowupType): TypeMeta {
  switch (type) {
    case "keranjang":
      return {
        label: "Keranjang",
        Icon: ShoppingCart,
        badgeClass:
          "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
      };
    case "pembayaran":
      return {
        label: "Pembayaran",
        Icon: CreditCard,
        badgeClass:
          "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
      };
    case "konfirmasi":
      return {
        label: "Konfirmasi",
        Icon: PackageCheck,
        badgeClass:
          "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
      };
    case "pascabeli":
      return {
        label: "Pasca-beli",
        Icon: MessageCircle,
        badgeClass:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
      };
    case "repeat":
      return {
        label: "Repeat order",
        Icon: Repeat,
        badgeClass:
          "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
      };
    case "ulasan":
      return {
        label: "Ulasan",
        Icon: Star,
        badgeClass:
          "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-400",
      };
  }
}

const STATUS_META: Record<FollowupStatus, { label: string; badgeClass: string }> = {
  menunggu: {
    label: "Menunggu",
    badgeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  },
  terkirim: {
    label: "Terkirim",
    badgeClass:
      "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  },
  dibalas: {
    label: "Dibalas",
    badgeClass:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  selesai: {
    label: "Selesai",
    badgeClass: "bg-muted text-muted-foreground",
  },
};

const ALL_TYPES: FollowupType[] = [
  "keranjang",
  "pembayaran",
  "konfirmasi",
  "pascabeli",
  "repeat",
  "ulasan",
];

// Build the prefilled WhatsApp message for a follow-up using a given template body.
function buildMessage(f: Followup, body: string) {
  return fillTemplate(body, {
    nama: f.customer,
    produk: f.context,
    no_pesanan: f.context,
    total: f.context,
    toko: TOKO,
  });
}

type TabKey = "semua" | "menunggu" | "telat" | "selesai";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "semua", label: "Semua" },
  { key: "menunggu", label: "Menunggu" },
  { key: "telat", label: "Telat" },
  { key: "selesai", label: "Selesai" },
];

export default function FollowupPage() {
  const [tab, setTab] = useState<TabKey>("semua");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"semua" | FollowupType>("semua");
  const [done, setDone] = useState<Set<string>>(new Set());

  function markDone(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  // Effective status accounts for rows marked done this session.
  const effStatus = (f: Followup): FollowupStatus =>
    done.has(f.id) ? "selesai" : f.status;
  const isTelat = (f: Followup) => f.dueDays < 0 && effStatus(f) === "menunggu";

  // ---- stats ----
  const stats = useMemo(() => {
    const menunggu = FOLLOWUPS.filter((f) => effStatus(f) === "menunggu").length;
    const telat = FOLLOWUPS.filter((f) => isTelat(f)).length;
    const terkirim = FOLLOWUPS.filter((f) => effStatus(f) === "terkirim").length;
    const dibalas = FOLLOWUPS.filter((f) => effStatus(f) === "dibalas").length;
    return [
      {
        label: "Menunggu",
        value: menunggu,
        icon: Clock,
        tint: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
        valueClass: "",
      },
      {
        label: "Telat",
        value: telat,
        icon: AlertTriangle,
        tint: "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400",
        valueClass: "text-red-600 dark:text-red-400",
      },
      {
        label: "Terkirim",
        value: terkirim,
        icon: Send,
        tint: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
        valueClass: "",
      },
      {
        label: "Dibalas",
        value: dibalas,
        icon: MessageCircle,
        tint: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
        valueClass: "text-emerald-600 dark:text-emerald-400",
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // ---- tab counts ----
  const counts = useMemo(() => {
    return {
      semua: FOLLOWUPS.length,
      menunggu: FOLLOWUPS.filter((f) => effStatus(f) === "menunggu").length,
      telat: FOLLOWUPS.filter((f) => isTelat(f)).length,
      selesai: FOLLOWUPS.filter((f) => effStatus(f) === "selesai").length,
    } as Record<TabKey, number>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // ---- filtered rows ----
  const rows = useMemo(() => {
    let list = FOLLOWUPS.slice();
    if (tab === "menunggu") list = list.filter((f) => effStatus(f) === "menunggu");
    else if (tab === "telat") list = list.filter((f) => isTelat(f));
    else if (tab === "selesai") list = list.filter((f) => effStatus(f) === "selesai");

    if (typeFilter !== "semua") list = list.filter((f) => f.type === typeFilter);

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (f) =>
          f.customer.toLowerCase().includes(q) ||
          f.context.toLowerCase().includes(q),
      );
    }
    // Overdue first, then due today, then upcoming.
    return list.sort((a, b) => a.dueDays - b.dueDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, typeFilter, query, done]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title="Follow-up WhatsApp"
        desc="Tindak lanjuti pelanggan otomatis via WhatsApp — keranjang, pembayaran, pasca-beli, dan repeat order."
      />

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-0 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {s.label}
              </span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg",
                  s.tint,
                )}
              >
                <s.icon className="size-4" />
              </span>
            </div>
            <div
              className={cn(
                "mt-3 text-2xl font-bold tracking-tight tabular-nums",
                s.valueClass,
              )}
            >
              {num(s.value)}
            </div>
          </Card>
        ))}
      </div>

      <Card className="gap-0 py-0">
        {/* tabs + toolbar */}
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                  {t.label}
                  <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {counts[t.key]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari pelanggan atau konteks…"
                className="h-8 w-full pl-8 sm:w-64"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="gap-2 whitespace-nowrap">
                    <span className="hidden sm:inline">
                      {typeFilter === "semua"
                        ? "Semua jenis"
                        : typeMeta(typeFilter).label}
                    </span>
                    <span className="sm:hidden">Jenis</span>
                    <ChevronDown className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Jenis follow-up</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setTypeFilter("semua")}
                  className={cn(
                    typeFilter === "semua" && "font-medium text-foreground",
                  )}
                >
                  Semua jenis
                </DropdownMenuItem>
                {ALL_TYPES.map((t) => {
                  const m = typeMeta(t);
                  return (
                    <DropdownMenuItem
                      key={t}
                      onClick={() => setTypeFilter(t)}
                      className={cn(
                        typeFilter === t && "font-medium text-foreground",
                      )}
                    >
                      <m.Icon className="size-4" /> {m.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Separator />

        {/* table */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Pelanggan</TableHead>
              <TableHead className="hidden sm:table-cell">Jenis</TableHead>
              <TableHead className="hidden lg:table-cell">Konteks</TableHead>
              <TableHead className="hidden md:table-cell">Jatuh tempo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[1%] pr-4 text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f) => {
              const meta = typeMeta(f.type);
              const status = effStatus(f);
              const smeta = STATUS_META[status];
              const isDone = status === "selesai";
              const tpl =
                WA_TEMPLATES.find((t) => t.type === f.type) ?? WA_TEMPLATES[0];
              const primaryLink = waLink(f.phone, buildMessage(f, tpl.body));

              return (
                <TableRow key={f.id} className="hover:bg-muted/40">
                  {/* Pelanggan */}
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-muted text-[11px] font-medium">
                          {initials(f.customer)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {f.customer}
                        </div>
                        <div className="truncate text-xs text-muted-foreground tabular-nums">
                          +{f.phone}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  {/* Jenis */}
                  <TableCell className="hidden sm:table-cell">
                    <Badge
                      className={cn("gap-1 border-transparent", meta.badgeClass)}
                    >
                      <meta.Icon className="size-3" />
                      {meta.label}
                    </Badge>
                  </TableCell>

                  {/* Konteks */}
                  <TableCell className="hidden max-w-[220px] lg:table-cell">
                    <span className="block truncate text-sm text-muted-foreground">
                      {f.context}
                    </span>
                  </TableCell>

                  {/* Jatuh tempo */}
                  <TableCell className="hidden md:table-cell">
                    <DueLabel dueDays={f.dueDays} />
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Badge
                      className={cn("border-transparent", smeta.badgeClass)}
                    >
                      {smeta.label}
                    </Badge>
                  </TableCell>

                  {/* Aksi */}
                  <TableCell className="pr-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {isDone ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          className="gap-1.5"
                        >
                          <Check className="size-4" /> Selesai
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          nativeButton={false}
                          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                          render={
                            <a
                              href={primaryLink}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          }
                        >
                          <Send className="size-4" /> Kirim WA
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Aksi lainnya"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuLabel>Ganti template</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {WA_TEMPLATES.map((t) => (
                            <DropdownMenuItem
                              key={t.id}
                              render={
                                <a
                                  href={waLink(f.phone, buildMessage(f, t.body))}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                />
                              }
                            >
                              <MessageCircle className="size-4" /> {t.name}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={isDone}
                            onClick={() => markDone(f.id)}
                          >
                            <Check className="size-4" /> Tandai selesai
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            render={<a href={`/pelanggan?cari=${encodeURIComponent(f.customer)}`} />}
                          >
                            <Eye className="size-4" /> Lihat pelanggan
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  Tidak ada follow-up yang cocok.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Separator />
        <div className="flex items-center justify-between p-4 text-xs text-muted-foreground">
          <span>Menampilkan {num(rows.length)} follow-up</span>
        </div>
      </Card>
    </div>
  );
}

function DueLabel({ dueDays }: { dueDays: number }) {
  if (dueDays === 0)
    return (
      <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
        Hari ini
      </span>
    );
  if (dueDays < 0)
    return (
      <span className="text-sm font-medium text-red-600 dark:text-red-400">
        Telat {Math.abs(dueDays)} hari
      </span>
    );
  return (
    <span className="text-sm text-muted-foreground">{dueDays} hari lagi</span>
  );
}
