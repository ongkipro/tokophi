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
import { getShippingRates, createShipment, trackShipment, cancelShipment, type Rate } from "@/lib/actions/shipping";
import { createOrderPayment } from "@/lib/actions/payments";
import type { OrderPayment } from "@/lib/data/payments";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStoreName } from "@/components/admin/store-context";
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

export function OrderDetail({ order, payment }: { order: Order; payment: OrderPayment | null }) {
  const { lines, subtotal, ongkir, penyesuaian, total } = breakdownFor(order);
  const step = currentStep(order.status);
  const cancelled = order.status === "batal";
  const seed = hash(order.id);

  const seededCourier = COURIERS[seed % COURIERS.length];
  const seededResi = `${seededCourier.split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "")}${(seed % 900000000) + 100000000}`;
  const courier = order.courierName ?? seededCourier;
  const resi = order.awb ?? seededResi;
  const shipped = !!order.awb;
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

  // live shipping rates from KiriminAja (platform-managed aggregator)
  const [rateOpen, setRateOpen] = React.useState(false);
  const [ratePending, startRate] = React.useTransition();
  const [rates, setRates] = React.useState<Rate[]>([]);
  const [rateMeta, setRateMeta] = React.useState<{ origin?: string; destination?: string }>({});
  const checkOngkir = () => {
    startRate(async () => {
      const weightGrams = (lines.reduce((a, l) => a + l.qty, 0) || 2) * 500;
      const r = await getShippingRates({ destinationCity: order.city, weightGrams, itemValue: subtotal });
      if (r.ok) {
        setRates(r.rates);
        setRateMeta({ origin: r.origin, destination: r.destination });
        setRateOpen(true);
      } else {
        toast.error(r.error ?? "Gagal cek ongkir");
      }
    });
  };

  // Create a real KiriminAja shipment from a chosen rate → saves AWB on the order.
  const [makingRate, setMakingRate] = React.useState<string | null>(null);
  const [insureShipment, setInsureShipment] = React.useState(false);
  const [codShipment, setCodShipment] = React.useState(false);
  const makeShipment = (rate: Rate) => {
    setMakingRate(rate.code + rate.type);
    startRate(async () => {
      const r = await createShipment({
        orderNumber: order.id.replace("#", ""),
        service: rate.code, serviceType: rate.type, serviceName: rate.service, cost: rate.cost,
        insurance: insureShipment, cod: codShipment,
      });
      setMakingRate(null);
      if (r.ok) {
        toast.success(`Pengiriman dibuat — resi ${r.awb}`);
        setRateOpen(false);
        router.refresh();
      } else {
        toast.error(r.error ?? "Gagal membuat pengiriman");
      }
    });
  };

  // cancel / void the shipment
  const [cancelling, setCancelling] = React.useState(false);
  const cancelNow = () => {
    if (!confirm("Batalkan pengiriman (void resi) untuk pesanan ini?")) return;
    setCancelling(true);
    startRate(async () => {
      const r = await cancelShipment(order.id.replace("#", ""));
      setCancelling(false);
      if (r.ok) { toast.success("Pengiriman dibatalkan."); router.refresh(); }
      else toast.error(r.error ?? "Gagal membatalkan pengiriman");
    });
  };

  // Poll KiriminAja tracking → sync the real courier AWB / show status.
  const [tracking, setTracking] = React.useState(false);
  const trackNow = () => {
    setTracking(true);
    startRate(async () => {
      const r = await trackShipment(order.id.replace("#", ""));
      setTracking(false);
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else {
        toast.message(r.message);
      }
    });
  };

  // Create a real payment bill (VA/QRIS/DANA) for this order via the platform PSP.
  const PAY_CHANNELS = [
    { code: "QRIS", label: "QRIS" }, { code: "VABCA", label: "VA BCA" }, { code: "VAMANDIRI", label: "VA Mandiri" },
    { code: "VABNI", label: "VA BNI" }, { code: "VABRI", label: "VA BRI" }, { code: "DANA", label: "DANA" },
  ];
  const [billOpen, setBillOpen] = React.useState(false);
  const createBill = (channelCode: string) => {
    startRate(async () => {
      const r = await createOrderPayment(order.id.replace("#", ""), channelCode);
      if (r.ok) { toast.success("Tagihan pembayaran dibuat."); setBillOpen(false); router.refresh(); }
      else toast.error(r.error ?? "Gagal membuat tagihan");
    });
  };
  const PAY_STATUS: Record<string, { label: string; cls: string }> = {
    berhasil: { label: "Dibayar", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
    menunggu: { label: "Menunggu pembayaran", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    gagal: { label: "Gagal / kedaluwarsa", cls: "bg-red-500/12 text-red-600 dark:text-red-400" },
  };

  // Print a shipping label (resi) → browser print dialog (Save as PDF). Uses the order's
  // courier + resi/AWB; store = sender. Self-contained HTML so it prints clean.
  const storeName = useStoreName();
  const printLabel = () => {
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const bars = Array.from({ length: 48 }, (_, i) => `<span style="width:${(hash(resi + i) % 3) + 1}px"></span>`).join("");
    const isCod = payMethod.toLowerCase().includes("cod");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Resi ${esc(order.id)}</title>
<style>
  @page { size: 100mm 150mm; margin: 0 }
  * { box-sizing: border-box; font-family: system-ui, sans-serif }
  body { margin: 0 }
  .label { width: 100mm; height: 150mm; padding: 5mm; border: 1px solid #000; display: flex; flex-direction: column; gap: 2mm }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 3mm }
  .courier { font-size: 18pt; font-weight: 800; letter-spacing: -.02em }
  .svc { font-size: 8pt; color: #333 }
  .cod { border: 2px solid #000; padding: 1mm 2mm; font-weight: 800; font-size: 11pt }
  .barcode { display: flex; align-items: flex-end; gap: 1px; height: 14mm; margin-top: 1mm }
  .barcode span { display: inline-block; height: 100%; background: #000 }
  .resi { font-family: ui-monospace, monospace; font-size: 12pt; font-weight: 700; letter-spacing: .05em; text-align: center }
  .box { border-top: 1px solid #000; padding-top: 2mm }
  .lbl { font-size: 7pt; text-transform: uppercase; letter-spacing: .08em; color: #555 }
  .val { font-size: 9.5pt; font-weight: 600; line-height: 1.35 }
  .foot { margin-top: auto; border-top: 1px dashed #000; padding-top: 2mm; display: flex; justify-content: space-between; font-size: 8pt }
</style></head><body>
  <div class="label">
    <div class="row">
      <div><div class="courier">${esc(courier)}</div><div class="svc">${esc(storeName)} · ${esc(order.id)}</div></div>
      ${isCod ? `<div class="cod">COD<br><span style="font-size:9pt">${IDR(total)}</span></div>` : `<div class="svc" style="text-align:right">NON-COD<br><b>${esc(payMethod)}</b></div>`}
    </div>
    <div class="barcode">${bars}</div>
    <div class="resi">${esc(resi)}</div>
    <div class="box"><div class="lbl">Penerima</div><div class="val">${esc(order.customer)}<br>${esc(order.city)}</div></div>
    <div class="box"><div class="lbl">Pengirim</div><div class="val">${esc(storeName)}</div></div>
    <div class="box"><div class="lbl">Isi (${order.items} item)</div><div class="val">${lines.map((l) => `${l.qty}× ${esc(l.name)}`).join(" · ")}</div></div>
    <div class="foot"><span>Berat ± ${((lines.reduce((a, l) => a + l.qty, 0) || 2) * 0.5).toFixed(1)} kg</span><span>Total ${IDR(total)}</span></div>
  </div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)}</script>
</body></html>`;
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) { toast.error("Popup diblokir — izinkan popup untuk mencetak resi."); return; }
    w.document.write(html);
    w.document.close();
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
          <Button variant="outline" onClick={checkOngkir} disabled={ratePending}>
            <Truck className="size-4" /> {ratePending ? "Cek ongkir…" : "Cek Ongkir"}
          </Button>
          <Button variant="ghost" onClick={printLabel}>
            <Printer /> Cetak resi
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
              {shipped && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 px-3 py-2">
                  <span className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Truck className="size-4" /> Pengiriman terdaftar
                  </span>
                  {canWrite && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" disabled={tracking} onClick={trackNow}>
                        {tracking ? "Melacak…" : "Lacak"}
                      </Button>
                      <Button size="sm" variant="outline" disabled={cancelling} onClick={cancelNow} className="text-red-600 hover:text-red-600">
                        {cancelling ? "…" : "Batalkan"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
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
                <span className="font-medium">{payment ? (payment.channelCode === "COD" ? "COD (Bayar di Tempat)" : PAY_CHANNELS.find((c) => c.code === payment.channelCode)?.label ?? payment.channelCode) : payMethod}</span>
              </div>
              {payment?.virtualAccount && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Virtual Account</span>
                  <span className="font-mono text-xs font-medium">{payment.virtualAccount}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Status</span>
                {payment ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAY_STATUS[payment.status].cls}`}>{PAY_STATUS[payment.status].label}</span>
                ) : paid ? (
                  <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">Dibayar</span>
                ) : (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Menunggu</span>
                )}
              </div>
              {payment && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Total (+admin)</span>
                  <span className="font-medium tabular-nums">{IDR(payment.total)}</span>
                </div>
              )}
              {!payment && canWrite && (
                <Button variant="outline" size="sm" className="w-full" disabled={ratePending} onClick={() => setBillOpen(true)}>
                  <CreditCard className="size-4" /> Buat Tagihan
                </Button>
              )}
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

      {/* Cek Ongkir (KiriminAja live rates) */}
      <Dialog open={rateOpen} onOpenChange={setRateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ongkir — {rateMeta.destination?.split(",")[0] ?? order.city}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {rateMeta.origin?.split(",")[0]} → {rateMeta.destination?.split(",")[0]} · ongkir real-time
          </p>
          {canWrite && !shipped && (
            <div className="mt-1 flex items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={insureShipment} onChange={(e) => setInsureShipment(e.target.checked)} className="size-4 accent-primary" /> Asuransi
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={codShipment} onChange={(e) => setCodShipment(e.target.checked)} className="size-4 accent-primary" /> COD (tagih {IDR(total)})
              </label>
            </div>
          )}
          <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Layanan</th>
                  <th className="px-3 py-2 font-medium">Estimasi</th>
                  <th className="px-3 py-2 text-right font-medium">Ongkir</th>
                  {canWrite && !shipped && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rates.map((r, i) => (
                  <tr key={r.service + i} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{r.service}{r.cod && <span className="ml-1.5 rounded bg-emerald-500/12 px-1 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">COD</span>}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.etd} hari</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{IDR(r.cost)}</td>
                    {canWrite && !shipped && (
                      <td className="px-2 py-2 text-right">
                        <Button size="sm" variant="outline" disabled={ratePending || (codShipment && !r.cod)} title={codShipment && !r.cod ? "Layanan ini tidak mendukung COD" : ""} onClick={() => makeShipment(r)}>
                          {makingRate === r.code + r.type ? "Membuat…" : "Buat"}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {rates.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Tidak ada layanan untuk rute ini.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{rates.length} layanan · tarif real-time · dikelola TokoΦ.</p>
        </DialogContent>
      </Dialog>

      {/* Buat Tagihan (create a payment bill) */}
      <Dialog open={billOpen} onOpenChange={setBillOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Buat Tagihan — {order.id}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Pilih metode pembayaran. Nomor VA / QRIS terbit otomatis untuk {IDR(total)}.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PAY_CHANNELS.map((c) => (
              <Button key={c.code} variant="outline" disabled={ratePending} onClick={() => createBill(c.code)}>
                {c.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
