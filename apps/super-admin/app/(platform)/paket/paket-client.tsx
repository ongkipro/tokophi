"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Wallet, Users, Receipt, MoreHorizontal, CircleCheck, CircleX, Clock } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tokophi/ui/card";
import { Badge } from "@tokophi/ui/badge";
import { Button } from "@tokophi/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@tokophi/ui/tabs";
import { cn } from "@tokophi/ui/lib/utils";

import { PLANS, type Plan, type Invoice } from "@/lib/mock";
import { PlanBadge, InvoiceBadge } from "@/components/bits";
import { setInvoiceStatus } from "@/lib/actions";
import { IDR, num } from "@tokophi/lib/format";

const INV_TABS: { key: "semua" | Invoice["status"]; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "dibayar", label: "Dibayar" },
  { key: "menunggu", label: "Menunggu" },
  { key: "gagal", label: "Gagal" },
];

type PlanDist = { plan: Plan; name: string; count: number; mrr: number };

export function PaketClient({
  mrr,
  activeStores,
  allInvoices,
  planDist,
}: {
  mrr: number;
  activeStores: number;
  allInvoices: Invoice[];
  planDist: PlanDist[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"semua" | Invoice["status"]>("semua");
  const subscriberCount = (plan: Plan) => planDist.find((d) => d.plan === plan)?.count ?? 0;

  function mark(inv: Invoice, status: Invoice["status"]) {
    if (status === inv.status) return;
    startTransition(async () => {
      await setInvoiceStatus(inv.id, status);
      toast.success(`Invoice ${inv.id} → ${status}.`);
      router.refresh();
    });
  }

  const summary = useMemo(
    () => [
      { label: "MRR", value: IDR(mrr, { compact: true }), icon: Wallet },
      {
        label: "Pelanggan berbayar",
        value: num(activeStores),
        icon: Users,
      },
      {
        label: "Tagihan bulan ini",
        value: num(allInvoices.length),
        icon: Receipt,
      },
    ],
    [mrr, activeStores, allInvoices],
  );

  const invoices = useMemo(
    () => (tab === "semua" ? allInvoices : allInvoices.filter((i) => i.status === tab)),
    [tab, allInvoices],
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Paket &amp; Billing</h1>
        <p className="text-sm text-muted-foreground">
          Kelola paket langganan dan tagihan platform.
        </p>
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {summary.map((s) => (
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
              {s.value}
            </div>
          </Card>
        ))}
      </div>

      {/* plan cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {PLANS.map((p) => {
          const popular = p.key === "bisnis";
          return (
            <Card
              key={p.key}
              className={cn(
                "flex flex-col",
                popular && "ring-2 ring-primary",
              )}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    {p.name}
                    {popular && (
                      <Badge className="bg-primary text-primary-foreground">
                        Populer
                      </Badge>
                    )}
                  </span>
                  <Badge variant="secondary" className="border-transparent">
                    {num(subscriberCount(p.key))} toko
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight tabular-nums">
                    {IDR(p.price)}
                  </span>
                  <span className="text-sm text-muted-foreground">/bln</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.blurb}</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                  {num(subscriberCount(p.key))} toko berlangganan
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* invoices */}
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Tagihan</CardTitle>
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "semua" | Invoice["status"])}
          >
            <TabsList>
              {INV_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead>Toko</TableHead>
                <TableHead>Paket</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.id}</TableCell>
                  <TableCell className="font-medium">{inv.store}</TableCell>
                  <TableCell>
                    <PlanBadge plan={inv.plan} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {IDR(inv.amount)}
                  </TableCell>
                  <TableCell>
                    <InvoiceBadge status={inv.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {inv.daysAgo} hari lalu
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Aksi ${inv.id}`} disabled={pending} />}>
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Ubah status</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={inv.status === "dibayar"} onClick={() => mark(inv, "dibayar")}>
                          <CircleCheck className="size-4 text-emerald-600" /> Tandai dibayar
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={inv.status === "menunggu"} onClick={() => mark(inv, "menunggu")}>
                          <Clock className="size-4 text-amber-600" /> Tandai menunggu
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={inv.status === "gagal"} onClick={() => mark(inv, "gagal")}>
                          <CircleX className="size-4 text-destructive" /> Tandai gagal
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Tidak ada tagihan.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
