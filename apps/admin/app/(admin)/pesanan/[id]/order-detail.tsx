"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Printer,
  PackageCheck,
  Truck,
  CheckCircle2,
  Check,
  XCircle,
  ClipboardList,
  CreditCard,
  MapPin,
  Store,
  Copy,
} from "lucide-react";

import { toast } from "sonner";
import { setOrderStatus } from "@/lib/actions/orders";
import { useCan } from "@/components/admin/permissions";
import { OrderStatusBadge } from "@/components/admin/order-status";
import { ProductThumb } from "@/components/admin/product-thumb";
import { IDR, timeAgo } from "@/lib/format";
import { PRODUCTS, type Order, type OrderStatus } from "@/lib/mock/store";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

// ------- deterministic helpers (seed from order id) -------

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

type Line = { name: string; emoji: string; image: string; qty: number; price: number };

// Fabricate a stable line-item breakdown; reconcile so the shown Total === order.total
// by putting the remainder into ongkir + a "penyesuaian" line.
function breakdownFor(order: Order) {
  const seed = hash(order.id);
  const lines: Line[] = [];
  for (let i = 0; i < order.items; i++) {
    const p = PRODUCTS[(seed + i * 7) % PRODUCTS.length];
    const qty = ((seed >> (i + 2)) & 3) === 0 ? 2 : 1;
    lines.push({ name: p.name, emoji: p.emoji, image: p.image, qty, price: p.price });
  }
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const ongkir = [0, 15_000, 20_000, 25_000][seed % 4];
  // Remainder makes the fabricated lines reconcile to the order's real total.
  const penyesuaian = order.total - subtotal - ongkir;
  return { lines, subtotal, ongkir, penyesuaian, total: order.total };
}

const COURIERS = ["JNE Reguler", "J&T Express", "SiCepat REG", "AnterAja", "Ninja Xpress"];
const PAY_METHODS = ["Transfer Bank BCA", "QRIS", "Virtual Account BNI", "GoPay", "ShopeePay"];

// ------- timeline -------

const TIMELINE = [
  { key: "dibuat", label: "Pesanan dibuat", desc: "Pesanan masuk dan menunggu diproses", icon: ClipboardList },
  { key: "proses", label: "Diproses", desc: "Pesanan sedang disiapkan", icon: PackageCheck },
  { key: "kirim", label: "Dikirim", desc: "Paket dalam perjalanan", icon: Truck },
  { key: "selesai", label: "Selesai", desc: "Pesanan diterima pelanggan", icon: CheckCircle2 },
] as const;

// Index of the current step (0-based) per status.
function currentStep(status: OrderStatus): number {
  switch (status) {
    case "baru":
      return 0;
    case "diproses":
      return 1;
    case "dikirim":
      return 2;
    case "selesai":
      return 3;
    case "batal":
      return -1;
  }
}

// Right-side primary action per status.
function primaryAction(status: OrderStatus): { label: string; icon: typeof PackageCheck; toast: string; next: OrderStatus } | null {
  switch (status) {
    case "baru":
      return { label: "Proses pesanan", icon: PackageCheck, toast: "Pesanan mulai diproses", next: "diproses" };
    case "diproses":
      return { label: "Tandai dikirim", icon: Truck, toast: "Pesanan ditandai dikirim", next: "dikirim" };
    case "dikirim":
      return { label: "Tandai selesai", icon: CheckCircle2, toast: "Pesanan ditandai selesai", next: "selesai" };
    default:
      return null;
  }
}

// ------- component -------

export function OrderDetail({ order }: { order: Order }) {
  const { lines, subtotal, ongkir, penyesuaian, total } = breakdownFor(order);
  const step = currentStep(order.status);
  const cancelled = order.status === "batal";
  const seed = hash(order.id);

  const courier = COURIERS[seed % COURIERS.length];
  const resi = `${courier.split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "")}${(seed % 900000000) + 100000000}`;
  const payMethod = PAY_METHODS[(seed >> 3) % PAY_METHODS.length];
  const paid = order.status !== "baru" && order.status !== "batal";

  const action = primaryAction(order.status);
  const router = useRouter();
  const canWrite = useCan("orders:write");
  const [pending, startTransition] = React.useTransition();
  const advance = () => {
    if (!action) return;
    startTransition(async () => {
      try {
        await setOrderStatus(order.id, action.next);
        toast.success(action.toast);
        router.refresh();
      } catch {
        toast.error("Gagal memperbarui status pesanan");
      }
    });
  };

  return (
    <div className="mx-auto max-w-[1100px]">
      {/* Top bar */}
      <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/pesanan" />}
            aria-label="Kembali ke Pesanan"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <Link href="/pesanan" className="hover:underline">
                Pesanan
              </Link>
            </p>
            <div className="flex items-center gap-2.5">
              <h1 className="truncate font-mono text-xl font-bold tracking-tight">{order.id}</h1>
              <OrderStatusBadge status={order.status} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => toast.success("Menyiapkan dokumen cetak…")}>
            <Printer /> Cetak
          </Button>
          {action && canWrite && (
            <Button onClick={advance} disabled={pending}>
              <action.icon /> {action.label}
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* MAIN */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          {/* Item pesanan */}
          <Card>
            <CardHeader>
              <CardTitle>Item pesanan</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Harga</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ProductThumb src={l.image} emoji={l.emoji} alt={l.name} className="size-10" emojiClassName="text-lg" />
                          <span className="font-medium">{l.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">{l.qty}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{IDR(l.price)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{IDR(l.qty * l.price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Separator className="my-4" />

              {/* summary */}
              <div className="ml-auto max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{IDR(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Ongkos kirim</span>
                  <span className="tabular-nums">{ongkir === 0 ? "Gratis" : IDR(ongkir)}</span>
                </div>
                {penyesuaian !== 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{penyesuaian < 0 ? "Diskon" : "Penyesuaian"}</span>
                    <span className="tabular-nums">
                      {penyesuaian < 0 ? `- ${IDR(-penyesuaian)}` : IDR(penyesuaian)}
                    </span>
                  </div>
                )}
                <Separator className="my-1.5" />
                <div className="flex justify-between pt-0.5 text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{IDR(total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Linimasa */}
          <Card>
            <CardHeader>
              <CardTitle>Linimasa</CardTitle>
            </CardHeader>
            <CardContent>
              {cancelled ? (
                <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <XCircle className="size-5 text-red-500" />
                  <div className="text-sm">
                    <div className="font-medium text-red-600 dark:text-red-400">Pesanan dibatalkan</div>
                    <div className="text-muted-foreground">Transaksi tidak dilanjutkan.</div>
                  </div>
                </div>
              ) : (
                <ol className="relative">
                  {TIMELINE.map((t, i) => {
                    const done = i < step;
                    const isCurrent = i === step;
                    const Icon = t.icon;
                    const last = i === TIMELINE.length - 1;
                    return (
                      <li key={t.key} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div
                            className={
                              "flex size-8 shrink-0 items-center justify-center rounded-full border " +
                              (done
                                ? "border-primary bg-primary text-primary-foreground"
                                : isCurrent
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground")
                            }
                          >
                            {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                          </div>
                          {!last && (
                            <div className={"my-1 w-px flex-1 " + (done ? "bg-primary" : "bg-border")} />
                          )}
                        </div>
                        <div className={last ? "pt-1" : "pb-6 pt-1"}>
                          <div
                            className={
                              "text-sm font-medium " +
                              (done || isCurrent ? "text-foreground" : "text-muted-foreground")
                            }
                          >
                            {t.label}
                          </div>
                          <div className="text-xs text-muted-foreground">{t.desc}</div>
                          {isCurrent && <div className="mt-0.5 text-xs font-medium text-primary">Sedang berlangsung</div>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR */}
        <div className="flex flex-col gap-5">
          {/* Pelanggan */}
          <Card>
            <CardHeader>
              <CardTitle>Pelanggan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>{initials(order.customer)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 leading-tight">
                  <div className="truncate font-medium">{order.customer}</div>
                  <div className="text-sm text-muted-foreground">{order.city}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pengiriman */}
          <Card>
            <CardHeader>
              <CardTitle>Pengiriman</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Truck className="size-4" /> Kurir
                </span>
                <span className="font-medium">{courier}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Copy className="size-4" /> No. resi
                </span>
                <span className="font-mono text-xs font-medium">{resi}</span>
              </div>
              <Separator />
              <div className="flex gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span className="leading-snug">
                  Jl. Merdeka No. {(seed % 90) + 1}, RT {String((seed % 12) + 1).padStart(2, "0")}/RW{" "}
                  {String((seed % 8) + 1).padStart(2, "0")}, {order.city}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Pembayaran */}
          <Card>
            <CardHeader>
              <CardTitle>Pembayaran</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <CreditCard className="size-4" /> Metode
                </span>
                <span className="font-medium">{payMethod}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Status</span>
                {paid ? (
                  <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Dibayar
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    Menunggu
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Store className="size-4" /> Sumber
                </span>
                <span className="font-medium">{order.channel}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Dibuat</span>
                <span className="font-medium">{timeAgo(order.minutesAgo)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 pt-0.5 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{IDR(total)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
