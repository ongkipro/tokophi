"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateCustomer } from "@/lib/actions/customers";
import { useCan } from "@/components/admin/permissions";
import {
  ChevronLeft,
  MessageCircle,
  Mail,
  Phone,
  MapPin,
  UserPlus,
  ShoppingBag,
  Award,
  Plus,
  X,
} from "lucide-react";

import { type Customer } from "@/lib/types/domain";
import type { CustomerOrder, CustomerRow } from "@/lib/data/customers";
import { AccountBadge } from "@/components/admin/pelanggan/account-badge";
import { IDR, num, timeAgo, waLink } from "@tokophi/lib/format";
import { cn } from "@tokophi/ui/lib/utils";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Badge } from "@tokophi/ui/badge";
import { Input } from "@tokophi/ui/input";
import { Label } from "@tokophi/ui/label";
import { Textarea } from "@tokophi/ui/textarea";
import { Separator } from "@tokophi/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tokophi/ui/table";
import { OrderStatusBadge } from "@/components/admin/order-status";

// ---- segment styling (per spec: vip=amber, loyal=violet, reguler=blue, baru=emerald) ----
const SEGMENT_META: Record<
  Customer["segment"],
  { label: string; cls: string }
> = {
  vip: {
    label: "VIP",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  loyal: {
    label: "Loyal",
    cls: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  },
  reguler: {
    label: "Reguler",
    cls: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
  },
  baru: {
    label: "Baru",
    cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  },
};

function SegmentBadge({ segment }: { segment: Customer["segment"] }) {
  const s = SEGMENT_META[segment];
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", s.cls)}>
      {s.label}
    </Badge>
  );
}

export function CustomerDetail({
  customer,
  orders,
}: {
  customer: CustomerRow;
  // Real order history for THIS customer (matched on orders.customer_id, from the DB).
  orders: CustomerOrder[];
}) {
  // Already sorted newest-first by the data layer; show the 6 most recent.
  const recentOrders = orders.slice(0, 6);
  const lastOrder = orders[0];
  const firstOrder = orders[orders.length - 1];

  const avgOrder =
    customer.orders > 0
      ? IDR(Math.round(customer.spent / customer.orders))
      : "—";

  // ---- editable tags + notes (persist to Postgres) ----
  const [tags, setTags] = React.useState<string[]>(
    customer.tags ?? ["pelanggan", SEGMENT_META[customer.segment].label.toLowerCase()],
  );
  const [tagInput, setTagInput] = React.useState("");
  const [note, setNote] = React.useState(customer.notes ?? "");

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (!t || tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }
  function removeTag(t: string) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  const router = useRouter();
  const canWrite = useCan("customers:write");
  const [saving, startSaving] = React.useTransition();
  const saveProfile = () => {
    if (!canWrite) {
      toast.error("Akses ditolak — peran Anda tidak bisa mengubah pelanggan");
      return;
    }
    startSaving(async () => {
      try {
        await updateCustomer(customer.id, { tags, notes: note });
        toast.success("Catatan pelanggan disimpan");
        router.refresh();
      } catch {
        toast.error("Gagal menyimpan");
      }
    });
  };

  const waHref = waLink(customer.phone, `Halo kak ${customer.name} 👋`);

  const stats = [
    { label: "Total belanja", value: IDR(customer.spent, { compact: true }) },
    { label: "Jumlah pesanan", value: num(customer.orders) },
    { label: "Rata-rata pesanan", value: avgOrder },
    {
      label: "Terakhir belanja",
      value: lastOrder ? timeAgo(lastOrder.minutesAgo) : "Belum ada",
    },
  ];

  const timeline = [
    {
      icon: UserPlus,
      title: "Bergabung",
      desc: timeAgo(customer.joinedDaysAgo * 24 * 60),
    },
    {
      icon: ShoppingBag,
      title: "Pesanan pertama",
      desc: firstOrder ? timeAgo(firstOrder.minutesAgo) : "Belum ada pesanan",
    },
    {
      icon: Award,
      title: `Menjadi pelanggan ${SEGMENT_META[customer.segment].label}`,
      desc: "Berdasarkan riwayat belanja",
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/pelanggan" />}
            aria-label="Kembali ke Pelanggan"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <Link href="/pelanggan" className="hover:underline">
                Pelanggan
              </Link>
            </p>
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight">
                {customer.name}
              </h1>
              <SegmentBadge segment={customer.segment} />
              <AccountBadge registered={customer.registered} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            nativeButton={false}
            render={
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <MessageCircle className="size-4" /> Kirim WhatsApp
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            nativeButton={false}
            render={<a href={`mailto:${customer.email}`} />}
          >
            <Mail className="size-4" /> Kirim email
          </Button>
        </div>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* MAIN */}
        <div className="space-y-5 lg:col-span-2">
          {/* stat row */}
          <Card className="p-0">
            <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              {stats.map((s) => (
                <div key={s.label} className="p-5">
                  <div className="text-xs text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="mt-1.5 text-lg font-bold tracking-tight tabular-nums">
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* recent orders */}
          <Card className="gap-0 py-0">
            <CardHeader className="px-5 py-4">
              <CardTitle className="text-base">Pesanan terakhir</CardTitle>
            </CardHeader>
            <Separator />
            {recentOrders.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Pesanan</TableHead>
                    <TableHead>Waktu</TableHead>
                    <TableHead className="text-right">Item</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="pr-5">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="pl-5 font-mono text-sm font-medium">
                        {o.id}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {timeAgo(o.minutesAgo)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(o.items)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {IDR(o.total)}
                      </TableCell>
                      <TableCell className="pr-5">
                        <OrderStatusBadge status={o.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                Belum ada pesanan
              </div>
            )}
          </Card>

          {/* activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aktivitas</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-6">
                {timeline.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="relative flex flex-col items-center">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <t.icon className="size-4" />
                      </span>
                      {i < timeline.length - 1 && (
                        <span className="mt-1 w-px flex-1 bg-border" />
                      )}
                    </div>
                    <div className="pb-1">
                      <div className="text-sm font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.desc}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR */}
        <div className="space-y-5 lg:col-span-1">
          {/* contact */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kontak</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2.5">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={`mailto:${customer.email}`}
                  className="truncate hover:underline"
                >
                  {customer.email}
                </a>
              </div>
              <div className="flex items-center gap-2.5">
                <Phone className="size-4 shrink-0 text-muted-foreground" />
                <span className="tabular-nums">+{customer.phone}</span>
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  WhatsApp
                </a>
              </div>
              <div className="flex items-center gap-2.5">
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <span>{customer.city}</span>
              </div>
            </CardContent>
          </Card>

          {/* shipping address — only what we actually store (no street/postal column yet) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alamat pengiriman</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="font-medium">{customer.name}</div>
              <div className="text-muted-foreground tabular-nums">
                +{customer.phone}
              </div>
              {customer.city ? (
                <>
                  <div className="text-muted-foreground">{customer.city}</div>
                  <div className="text-muted-foreground">Indonesia</div>
                </>
              ) : (
                <div className="text-muted-foreground">
                  Belum ada alamat tersimpan
                </div>
              )}
            </CardContent>
          </Card>

          {/* tags + notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tag</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      aria-label={`Hapus tag ${t}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {tags.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Belum ada tag
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="Tambah tag…"
                  className="h-8"
                />
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={addTag}
                  aria-label="Tambah tag"
                >
                  <Plus className="size-4" />
                </Button>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label htmlFor="catatan">Catatan</Label>
                <Textarea
                  id="catatan"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Catatan internal tentang pelanggan ini…"
                  className="min-h-20 resize-none"
                />
              </div>
              {canWrite && (
                <Button onClick={saveProfile} disabled={saving} className="w-full">
                  {saving ? "Menyimpan…" : "Simpan tag & catatan"}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* segment + account */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Segmen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <SegmentBadge segment={customer.segment} />
                <div className="text-sm text-muted-foreground">
                  Pelanggan sejak {num(customer.joinedDaysAgo)} hari lalu
                </div>
              </div>

              <Separator />

              {/* Akun (customers.registered_at). Tamu = normal: belanja di sini tidak pernah
                  mewajibkan akun, dan memang tidak boleh — itu keputusan, bukan kekurangan data. */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AccountBadge registered={customer.registered} />
                </div>
                <div className="text-sm text-muted-foreground">
                  {customer.registered
                    ? `Membuat akun ${num(customer.registeredDaysAgo ?? 0)} hari lalu — bisa masuk & melihat riwayat pesanannya sendiri.`
                    : "Belanja tanpa akun. Normal — checkout tidak pernah mewajibkan pendaftaran. Dikenali lewat nomor WhatsApp & email."}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
