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
  Undo2,
  AlertTriangle,
  Mail,
  Phone,
} from "lucide-react";

import { toast } from "sonner";
import { setOrderStatus } from "@/lib/actions/orders";
import type { OrderReturn } from "./return-info";
import {
  getShippingRates,
  createShipment,
  trackShipment,
  cancelShipment,
  fillDemoResi,
  type Rate,
  type TrackResult,
} from "@/lib/actions/shipping";
import {
  buildLabelHtml,
  composeSenderLine,
  formatWeight,
} from "@/components/admin/pesanan/shipping-label";
import { createOrderPayment } from "@/lib/actions/payments";
import type { OrderDetail as OrderDetailData } from "@/lib/data/order-detail";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@tokophi/ui/dialog";
import { useStoreName } from "@/components/admin/store-context";
import { useCan } from "@/components/admin/permissions";
import { OrderStatusBadge } from "@/components/admin/order-status";
import { ProductThumb } from "@/components/admin/product-thumb";
import { IDR, timeAgo } from "@tokophi/lib/format";
import type { Order, OrderStatus } from "@/lib/mock/store";

import { Card, CardHeader, CardTitle, CardContent } from "@tokophi/ui/card";
import { Button } from "@tokophi/ui/button";
import { Separator } from "@tokophi/ui/separator";
import { Textarea } from "@tokophi/ui/textarea";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@tokophi/ui/table";

// The COD fee the aggregator deducts from the merchant's COD payout (N31) — the number every rate
// response already carried while nothing displayed it. Generic wording only: the provider's brand
// stays hidden from merchants (ADR 0004). Nothing to say ⇒ null, never "Rp0".
function codFeeLabel(fee: Rate["codFee"]): string | null {
  if (fee.amount !== null) return `Biaya COD +${IDR(fee.amount)}`;
  if (fee.pct !== null) {
    const p = `${fee.pct.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
    return fee.minimum !== null
      ? `Biaya COD ${p} (min ${IDR(fee.minimum)})`
      : `Biaya COD ${p}`;
  }
  return null;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ------- timeline -------

const TIMELINE = [
  {
    key: "dibuat",
    label: "Pesanan dibuat",
    desc: "Pesanan masuk dan menunggu diproses",
    icon: ClipboardList,
  },
  {
    key: "proses",
    label: "Diproses",
    desc: "Pesanan sedang disiapkan",
    icon: PackageCheck,
  },
  {
    key: "kirim",
    label: "Dikirim",
    desc: "Paket dalam perjalanan",
    icon: Truck,
  },
  {
    key: "selesai",
    label: "Selesai",
    desc: "Pesanan diterima pelanggan",
    icon: CheckCircle2,
  },
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
    // The parcel shipped and came back — it is NOT a step on the happy path, and it is not `batal`
    // either (that one never left). -1 drops it out of the pipeline, same as a cancellation.
    case "retur":
      return -1;
  }
}

// Right-side primary action per status.
function primaryAction(
  status: OrderStatus,
): {
  label: string;
  icon: typeof PackageCheck;
  toast: string;
  next: OrderStatus;
} | null {
  switch (status) {
    case "baru":
      return {
        label: "Proses pesanan",
        icon: PackageCheck,
        toast: "Pesanan mulai diproses",
        next: "diproses",
      };
    case "diproses":
      return {
        label: "Tandai dikirim",
        icon: Truck,
        toast: "Pesanan ditandai dikirim",
        next: "dikirim",
      };
    case "dikirim":
      return {
        label: "Tandai selesai",
        icon: CheckCircle2,
        toast: "Pesanan ditandai selesai",
        next: "selesai",
      };
    default:
      return null;
  }
}

// ------- component -------

const DEFAULT_RETURN_REASON = "Pembeli menolak paket";

export function OrderDetail({
  order,
  detail,
  orderReturn,
  demoAllowed = false,
}: {
  order: Order;
  detail: OrderDetailData;
  orderReturn: OrderReturn | null;
  demoAllowed?: boolean;
}) {
  // Everything below is REAL: `detail` comes from order_line_items / orders / customers /
  // customer_addresses / payments.
  const { lines, money, shipment, buyer, address, payment, sender, financial } =
    detail;
  // The order's own destination (orders.city/province) — the only city this parcel is tied to.
  const destination =
    [shipment.city, shipment.province].filter(Boolean).join(", ") ||
    "Kota tujuan tidak tercatat";
  // A saved address only counts as this parcel's address when its city matches the order's.
  const usableAddress =
    address?.street && address.cityMatchesOrder ? address : null;
  const step = currentStep(order.status);
  const cancelled = order.status === "batal";
  const returned = order.status === "retur";

  // Two DIFFERENT facts, deliberately not collapsed into one:
  //   booked   — KiriminAja accepted the pickup request (orders.ka_order_id).
  //   hasResi  — a COURIER issued a waybill (orders.awb). This is what a label needs.
  // A booking without a waybill is the normal state right after "Buat Pengiriman"; the AWB arrives
  // when the courier accepts the parcel and is synced by "Lacak".
  const booked = !!shipment.kaOrderId || !!shipment.awb;
  const hasResi = !!shipment.awb;
  const totalQty = lines.reduce((a, l) => a + l.qty, 0);
  const isCod = payment?.method === "cod";
  const canBookShipment = isCod || payment?.status === "berhasil";
  // A gateway bill (VA/QRIS/DANA) exists only when the payments row carries a channel code.
  const hasBill = !!payment?.channelCode;
  const canBill = !payment || (!hasBill && payment.status !== "berhasil");

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

  // ---- Retur (paket kembali) ----
  // Only a parcel that actually left the gudang can come back, so this is offered on `dikirim`
  // only. It is NOT cosmetic: setOrderStatus(…, "retur") puts the stock back on the shelf and
  // fails any still-pending payment (a refused COD parcel = cash never collected) — hence the
  // explicit confirm dialog rather than a one-click status flip.
  const canReturn = order.status === "dikirim";
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [returnReason, setReturnReason] = React.useState(DEFAULT_RETURN_REASON);
  const markReturned = () => {
    startTransition(async () => {
      try {
        await setOrderStatus(
          order.id,
          "retur",
          returnReason.trim() || DEFAULT_RETURN_REASON,
        );
        setReturnOpen(false);
        toast.success("Pesanan ditandai retur — stok dikembalikan.");
        router.refresh();
      } catch {
        toast.error("Gagal menandai retur");
      }
    });
  };

  // live shipping rates from KiriminAja (platform-managed aggregator)
  const [rateOpen, setRateOpen] = React.useState(false);
  const [ratePending, startRate] = React.useTransition();
  const [rates, setRates] = React.useState<Rate[]>([]);
  const [rateMeta, setRateMeta] = React.useState<{
    origin?: string;
    destination?: string;
  }>({});
  // COD is offered here only when the store's own switch (Pengaturan → Jasa Kirim) + the platform
  // allow it; the rates response carries the effective flag per service (lib/cod.ts).
  const [codAvailable, setCodAvailable] = React.useState(false);
  const checkOngkir = () => {
    startRate(async () => {
      // The order number is ALL the server needs — and all it will accept. It prices against the
      // order's own KiriminAja district (`orders.ship_district_id`: the one the shopper picked and
      // paid ongkir for) and the real summed weight of its line items. This screen used to also
      // post `weightGrams: (totalQty || 2) * 500` and `destinationCity: order.city`, and both were
      // guesses the booking then contradicted — one parcel, two different numbers.
      const r = await getShippingRates({
        orderNumber: order.id.replace("#", ""),
      });
      if (r.ok) {
        setRates(r.rates);
        setRateMeta({ origin: r.origin, destination: r.destination });
        setCodAvailable(!!r.codEnabled);
        if (!r.codEnabled) setCodShipment(false);
        setRateOpen(true);
      } else {
        toast.error(r.error ?? "Gagal cek ongkir");
      }
    });
  };

  // Book a real KiriminAja shipment from a chosen rate.
  //
  // On success this persists the booking reference + courier and moves the order to `dikirim`. It
  // does NOT necessarily produce a resi: KiriminAja returns `awb: null` until a courier accepts the
  // pickup. The toast says which of the two happened, because the difference decides whether the
  // merchant can print a label — telling them "resi dibuat" when no resi exists is the lie this
  // whole flow was rebuilt to remove.
  const [makingRate, setMakingRate] = React.useState<string | null>(null);
  const [confirmRate, setConfirmRate] = React.useState<Rate | null>(null);
  const confirmDelta = confirmRate
    ? Math.round(confirmRate.cost) - financial.shippingCharged
    : 0;
  const confirmDebit = Math.max(0, confirmDelta);
  const confirmMargin = Math.max(0, -confirmDelta);
  const confirmEntitlement = financial.goodsProceeds - confirmDebit;
  const [insureShipment, setInsureShipment] = React.useState(false);
  // Seeded from the ORDER, not defaulted to false. Unseeded, a genuine COD parcel was booked telling
  // the courier to collect 0 — and "Tandai selesai" then credited the merchant the full sale as
  // withdrawable for cash nobody collected. It is now a mirror of the fact, not an independent switch:
  // `createShipment` derives the real value and REFUSES a booking that disagrees with it.
  const [codShipment, setCodShipment] = React.useState(isCod);
  const [senderError, setSenderError] = React.useState<string | null>(null);
  const makeShipment = (rate: Rate) => {
    setMakingRate(rate.code + rate.type);
    setSenderError(null);
    startRate(async () => {
      const r = await createShipment({
        orderNumber: order.id.replace("#", ""),
        service: rate.code,
        serviceType: rate.type,
        serviceName: rate.service,
        cost: rate.cost,
        insurance: insureShipment,
        cod: codShipment,
      });
      setMakingRate(null);
      if (r.ok) {
        setRateOpen(false);
        setConfirmRate(null);
        if (r.destinationGuessed) {
          // The order predates the address snapshot, so the district was fuzzy-matched from its city
          // name. That match once turned "Surabaya" into "Bandar Surabaya, LAMPUNG". The booking has
          // already gone out — the merchant cannot approve it, only check it — so this stays on
          // screen far longer than a success toast and names the district we actually picked.
          toast.warning("Tujuan pengiriman ditebak dari nama kota", {
            description: `Pesanan ini tidak menyimpan kecamatan tujuan, jadi kurir dibooking ke “${r.destinationGuessed}”. Periksa apakah itu benar — kalau salah, batalkan pengiriman ini sebelum kurir menjemput.`,
            duration: 20000,
          });
        }
        if (r.awb) {
          toast.success(`Pengiriman dibuat — resi ${r.awb}`);
        } else {
          toast.success("Pengiriman dibooking ke kurir.", {
            description:
              // The poller fills this on its own (see massal-client) — "Lacak" is the shortcut.
              "Kurir belum menerbitkan nomor resi. Resi muncul sendiri begitu kurir menerima pesanan; “Lacak” hanya mempercepat. Label bisa dicetak setelah resi terbit.",
            duration: 8000,
          });
        }
        router.refresh();
      } else if (r.senderIncomplete) {
        // The single most common blocker, and the one the merchant can actually fix. Keep it on
        // screen (not just a transient toast) and point at the exact page.
        setSenderError(r.error ?? "Alamat pengirim belum lengkap.");
        toast.error("Alamat pengirim belum lengkap", {
          description: r.error,
          action: {
            label: "Buka Pengaturan",
            onClick: () => router.push("/pengaturan"),
          },
          duration: 10000,
        });
      } else {
        toast.error(r.error ?? "Gagal membuat pengiriman", { duration: 8000 });
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
      if (r.ok) {
        toast.info(
          r.pending
            ? "Permintaan pembatalan dikirim. Resi dan debit ongkir tetap tercatat sampai kurir mengonfirmasi."
            : "Pengiriman dibatalkan.",
        );
        router.refresh();
      } else toast.error(r.error ?? "Gagal membatalkan pengiriman");
    });
  };

  // Poll KiriminAja tracking → show the real response and sync the courier AWB the moment it
  // exists. The result is rendered in a dialog rather than flashed as a toast: the tracking
  // history IS the answer to "where is my parcel", and throwing it away to show a one-line toast
  // was the reason this button felt like a placeholder.
  const [tracking, setTracking] = React.useState(false);
  const [trackOpen, setTrackOpen] = React.useState(false);
  const [track, setTrack] = React.useState<TrackResult | null>(null);
  const trackNow = () => {
    setTracking(true);
    startRate(async () => {
      const r = await trackShipment(order.id.replace("#", ""));
      setTracking(false);
      setTrack(r);
      setTrackOpen(true);
      if (r.ok && r.awb) router.refresh(); // a resi may have just landed → re-read the order
    });
  };

  // DEMO/SANDBOX ONLY — "Cetak resi" itself stamps a placeholder AWB then prints when there is no real
  // resi yet (see printLabel). The action refuses in production; the button path only runs when allowed.
  const [demoPending, startDemo] = React.useTransition();

  // Create a real payment bill (VA/QRIS/DANA) for this order via the platform PSP.
  const PAY_CHANNELS = [
    { code: "QRIS", label: "QRIS" },
    { code: "VABCA", label: "VA BCA" },
    { code: "VAMANDIRI", label: "VA Mandiri" },
    { code: "VABNI", label: "VA BNI" },
    { code: "VABRI", label: "VA BRI" },
    { code: "DANA", label: "DANA" },
  ];
  const [billOpen, setBillOpen] = React.useState(false);
  const createBill = (channelCode: string) => {
    startRate(async () => {
      const r = await createOrderPayment(
        order.id.replace("#", ""),
        channelCode,
      );
      if (r.ok) {
        toast.success("Tagihan pembayaran dibuat.");
        setBillOpen(false);
        router.refresh();
      } else toast.error(r.error ?? "Gagal membuat tagihan");
    });
  };
  const PAY_STATUS: Record<string, { label: string; cls: string }> = {
    berhasil: {
      label: "Dibayar",
      cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    },
    menunggu: {
      label: "Menunggu pembayaran",
      cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    },
    gagal: {
      label: "Gagal / kedaluwarsa",
      cls: "bg-red-500/12 text-red-600 dark:text-red-400",
    },
  };

  // Print a shipping label (resi) → browser print dialog (Save as PDF / thermal 100×150mm).
  //
  // Hard requirement: a REAL `orders.awb`. Not the KiriminAja booking reference, not the order
  // number, not a placeholder. A label is the thing a courier scans; a number no courier issued
  // makes the parcel undeliverable while looking perfectly fine on the desk. So when the AWB is
  // missing we refuse and explain, and the barcode itself is a genuine Code 128-B encoding of that
  // exact AWB (see components/admin/pesanan/shipping-label.ts).
  const storeName = useStoreName();

  // Build the thermal label for a given awb/courier and write it into `win` (an already-open window,
  // so it survives the popup blocker across an await) or a fresh one.
  const writeLabel = (awb: string, courier: string, win: Window | null) => {
    // Street only when the saved address actually belongs to this order's city; otherwise the
    // label carries the destination the order recorded and nothing more. The kodepos rides in its
    // OWN LabelInput slot (destinationPostcode), not glued into this string.
    const dest = usableAddress
      ? [usableAddress.street, usableAddress.city, usableAddress.province]
          .filter(Boolean)
          .join(", ")
      : destination;
    let html: string;
    try {
      html = buildLabelHtml({
        awb,
        courier,
        serviceName: shipment.serviceName ?? shipment.serviceType,
        orderNumber: order.id,
        storeName,
        senderLine: sender ? composeSenderLine(sender) : null,
        senderPhone: sender?.phone ?? null,
        senderPostcode: sender?.postcode ?? null,
        recipient: usableAddress?.recipient ?? buyer?.name ?? order.customer,
        destination: dest,
        destinationPostcode: usableAddress?.postcode ?? null,
        recipientPhone: usableAddress?.phone ?? buyer?.phone ?? null,
        kaOrderId: shipment.kaOrderId,
        cod: isCod,
        totalLabel: IDR(money.total),
        paymentLabel: payment?.methodLabel ?? "Belum ada pembayaran",
        items: lines.map((l) => ({
          qty: l.qty,
          title: l.title,
          variant: l.variant,
          priceLabel: IDR(l.price),
        })),
        totalQty,
        weightLabel: formatWeight(shipment.weightGrams),
      });
    } catch {
      if (win) win.close();
      toast.error("Label tidak bisa dibuat — nomor resi tidak valid.");
      return;
    }
    const w = win ?? window.open("", "_blank", "width=460,height=700");
    if (!w) {
      toast.error("Popup diblokir — izinkan popup untuk mencetak resi.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const printLabel = () => {
    // Real resi → print directly.
    if (shipment.awb && shipment.courier) {
      writeLabel(shipment.awb, shipment.courier, null);
      return;
    }
    // Sandbox demo → open the window NOW inside the click gesture (so it isn't popup-blocked after the
    // await), stamp a placeholder resi, then fill that same window with the label.
    if (demoAllowed) {
      const w = window.open("", "_blank", "width=460,height=700");
      if (!w) {
        toast.error("Popup diblokir — izinkan popup untuk mencetak resi.");
        return;
      }
      w.document.write(
        "<p style='font-family:system-ui,sans-serif;padding:24px;color:#555'>Menyiapkan label…</p>",
      );
      startDemo(async () => {
        const r = await fillDemoResi(order.id.replace("#", ""));
        if (r.ok && r.awb) {
          writeLabel(r.awb, shipment.courier ?? "spx", w);
          router.refresh();
        } else {
          w.close();
          toast.error(r.error ?? "Gagal menyiapkan resi contoh.");
        }
      });
      return;
    }
    // No resi and not sandbox → explain.
    toast.error("Belum ada nomor resi — label tidak bisa dicetak.", {
      description: booked
        ? "Pengiriman sudah dibooking, tapi kurir belum menerbitkan resi. Resi muncul sendiri begitu kurir menerima pesanan — “Lacak” hanya mempercepat."
        : "Buat pengiriman dulu lewat “Cek Ongkir” → pilih layanan → Buat.",
      duration: 8000,
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
              <h1 className="truncate font-mono text-xl font-bold tracking-tight">
                {order.id}
              </h1>
              <OrderStatusBadge status={order.status} />
              {/* ALONGSIDE the status, never instead of it: the order really is still `dikirim` —
                  the parcel is out, it just is not moving. The detail (kurir's reason + since when)
                  lives in the Pengiriman card; this is the "something is wrong here" marker you see
                  before you read anything else. */}
              {shipment.problemAt && (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400"
                  title={
                    shipment.problemNote ??
                    "Kurir melaporkan kendala pengiriman."
                  }
                >
                  <AlertTriangle className="size-3.5" /> Kendala pengiriman
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={checkOngkir}
            disabled={ratePending || !canBookShipment}
            title={
              canBookShipment
                ? undefined
                : "Pesanan prepaid hanya dapat dikirim setelah pembayaran berhasil."
            }
          >
            <Truck className="size-4" />{" "}
            {ratePending
              ? "Cek ongkir…"
              : canBookShipment
                ? "Cek Ongkir"
                : "Menunggu pembayaran"}
          </Button>
          <Button
            variant="ghost"
            onClick={printLabel}
            disabled={demoPending || (!hasResi && !demoAllowed)}
            title={
              hasResi
                ? `Cetak label resi ${shipment.awb}`
                : demoAllowed
                  ? "Cetak label dengan resi contoh (mode demo/sandbox)"
                  : booked
                    ? "Pengiriman sudah dibooking, tapi kurir belum menerbitkan nomor resi — klik Lacak"
                    : "Belum ada resi — buat pengiriman dulu"
            }
          >
            <Printer /> {demoPending ? "Menyiapkan…" : "Cetak resi"}
          </Button>
          {canReturn && canWrite && (
            <Button
              variant="outline"
              className="text-orange-600 hover:text-orange-600"
              disabled={pending}
              onClick={() => {
                setReturnReason(DEFAULT_RETURN_REASON);
                setReturnOpen(true);
              }}
            >
              <Undo2 /> Tandai retur
            </Button>
          )}
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
                    <TableHead className="w-[48%]">Produk</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Harga</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      <TableCell className="max-w-md">
                        <div className="flex items-center gap-3">
                          <ProductThumb
                            src={l.image ?? undefined}
                            emoji={l.emoji ?? "📦"}
                            alt={l.title}
                            className="size-10"
                            emojiClassName="text-lg"
                          />
                          <div className="min-w-0 flex-1 leading-tight">
                            <div
                              className="line-clamp-2 whitespace-normal break-words font-medium"
                              title={l.title}
                            >
                              {l.title}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {l.variant ?? "Tanpa varian"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">
                        {l.qty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {IDR(l.price)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {IDR(l.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {lines.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Pesanan ini tidak punya baris item.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <Separator className="my-4" />

              {/* summary — every figure below is a stored column, nothing is back-solved */}
              <div className="ml-auto max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{IDR(money.subtotal)}</span>
                </div>
                {money.discount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Diskon</span>
                    <span className="tabular-nums">
                      - {IDR(money.discount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Ongkos kirim</span>
                  <span className="tabular-nums">
                    {money.shipping === 0
                      ? "Belum ada ongkir"
                      : IDR(money.shipping)}
                  </span>
                </div>
                {money.tax > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{money.taxInclusive ? "Termasuk PPN" : "PPN"}</span>
                    <span className="tabular-nums">{IDR(money.tax)}</span>
                  </div>
                )}
                <Separator className="my-1.5" />
                <div className="flex justify-between pt-0.5 text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{IDR(money.total)}</span>
                </div>
              </div>

              {/* A discrepancy is information — surface it, do not paper over it. */}
              {money.mismatch && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <div className="space-y-0.5 text-muted-foreground">
                    <div className="font-medium text-amber-700 dark:text-amber-400">
                      Angka pesanan ini tidak cocok
                    </div>
                    <div>
                      Jumlah baris item:{" "}
                      <span className="tabular-nums text-foreground">
                        {IDR(money.lineSum)}
                      </span>{" "}
                      · subtotal tersimpan:{" "}
                      <span className="tabular-nums text-foreground">
                        {IDR(money.subtotal)}
                      </span>
                    </div>
                    <div>
                      {money.taxInclusive
                        ? "Subtotal − diskon + ongkir (PPN termasuk)"
                        : "Subtotal − diskon + ongkir + pajak"}{" "}
                      ={" "}
                      <span className="tabular-nums text-foreground">
                        {IDR(money.computedTotal)}
                      </span>{" "}
                      · total tersimpan:{" "}
                      <span className="tabular-nums text-foreground">
                        {IDR(money.total)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linimasa */}
          <Card>
            <CardHeader>
              <CardTitle>Linimasa</CardTitle>
            </CardHeader>
            <CardContent>
              {returned ? (
                <div className="flex items-start gap-3 rounded-lg border border-orange-500/25 bg-orange-500/5 p-3">
                  <Undo2 className="mt-0.5 size-5 shrink-0 text-orange-500" />
                  <div className="space-y-1 text-sm">
                    <div className="font-medium text-orange-700 dark:text-orange-400">
                      Paket kembali (retur)
                    </div>
                    <div className="text-muted-foreground">
                      Alasan:{" "}
                      <span className="text-foreground">
                        {orderReturn?.reason ?? DEFAULT_RETURN_REASON}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Kembali pada:{" "}
                      <span className="text-foreground">
                        {orderReturn?.returnedAtLabel ?? "Waktu tidak tercatat"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Stok sudah dikembalikan dan tagihan yang belum dibayar
                      ditandai gagal.
                    </div>
                  </div>
                </div>
              ) : cancelled ? (
                <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <XCircle className="size-5 text-red-500" />
                  <div className="text-sm">
                    <div className="font-medium text-red-600 dark:text-red-400">
                      Pesanan dibatalkan
                    </div>
                    <div className="text-muted-foreground">
                      Transaksi tidak dilanjutkan.
                    </div>
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
                            {done ? (
                              <Check className="size-4" />
                            ) : (
                              <Icon className="size-4" />
                            )}
                          </div>
                          {!last && (
                            <div
                              className={
                                "my-1 w-px flex-1 " +
                                (done ? "bg-primary" : "bg-border")
                              }
                            />
                          )}
                        </div>
                        <div className={last ? "pt-1" : "pb-6 pt-1"}>
                          <div
                            className={
                              "text-sm font-medium " +
                              (done || isCurrent
                                ? "text-foreground"
                                : "text-muted-foreground")
                            }
                          >
                            {t.label}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t.desc}
                          </div>
                          {isCurrent && (
                            <div className="mt-0.5 text-xs font-medium text-primary">
                              Sedang berlangsung
                            </div>
                          )}
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
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>
                    {initials(buyer?.name ?? order.customer)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 leading-tight">
                  <div className="truncate font-medium">
                    {buyer?.name ?? order.customer}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {[buyer?.city, buyer?.province]
                      .filter(Boolean)
                      .join(", ") || "Kota tidak tercatat"}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="size-4 shrink-0" />
                  <span className="truncate">
                    {buyer?.phone ?? "Nomor HP belum ada"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="size-4 shrink-0" />
                  <span className="truncate">
                    {buyer?.email ?? "Email belum ada"}
                  </span>
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
              {/* THE STUCK PARCEL, at the top of the card the seller opens to answer "where is it?".
                  Set by the tracking poller (orders.problem_at, migration 0062) and cleared by the
                  same poller the moment the courier reports movement again — so if this is on the
                  screen, it is true RIGHT NOW. It is not dismissable by hand on purpose: a seller
                  clicking it away would not unstick the parcel, it would only unstick the warning. */}
              {shipment.problemAt && (
                <div className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-red-700 dark:text-red-400">
                    <AlertTriangle className="size-4 shrink-0" /> Kendala
                    pengiriman
                  </div>
                  <p className="text-[11px] leading-snug text-foreground">
                    {shipment.problemNote ??
                      "Kurir melaporkan kendala pengiriman."}
                  </p>
                  {shipment.problemAtLabel && (
                    <p className="text-[11px] text-muted-foreground">
                      Dilaporkan kurir sejak {shipment.problemAtLabel}. Tanda
                      ini hilang sendiri begitu paket bergerak lagi.
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Truck className="size-4" /> Kurir
                </span>
                {shipment.courier ? (
                  <span className="font-medium">{shipment.courier}</span>
                ) : (
                  <span className="text-muted-foreground">
                    Kurir belum dipilih
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Copy className="size-4" /> No. resi
                </span>
                {shipment.awb ? (
                  <span className="font-mono text-xs font-medium">
                    {shipment.awb}
                  </span>
                ) : booked ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    Menunggu resi dari kurir
                  </span>
                ) : (
                  <span className="text-muted-foreground">Belum ada resi</span>
                )}
              </div>
              {/* The booking reference is real and worth showing — but it is NOT the resi, and the
                  label never treats it as one. */}
              {shipment.kaOrderId && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Ref. booking</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {shipment.kaOrderId}
                  </span>
                </div>
              )}
              {shipment.pickupNumber && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">No. penjemputan</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {shipment.pickupNumber}
                  </span>
                </div>
              )}
              {/* WHO PAYS THE COURIER. On COD the buyer does and there is nothing to chase; on a
                  prepaid order WE owe the shipping cost, and an unpaid booking never gets a waybill
                  — the parcel simply does not ship. That case used to be completely invisible:
                  "Menunggu resi dari kurir" above would sit there forever with nothing saying why.
                  `unknown` renders nothing at all — every order booked before 0087 has no reading,
                  and a shrug is not worth a row. */}
              {booked && shipment.payment.flow !== "unknown" && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Ongkir ke kurir</span>
                  <span
                    className={
                      shipment.payment.blocking
                        ? "text-right font-medium text-red-600 dark:text-red-400"
                        : "text-right text-muted-foreground"
                    }
                  >
                    {shipment.paymentLabel}
                    {shipment.payment.flow === "va" &&
                      !shipment.payment.settled &&
                      shipment.payment.payUrl && (
                        <>
                          {" · "}
                          <a
                            href={shipment.payment.payUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                          >
                            Bayar
                          </a>
                        </>
                      )}
                  </span>
                </div>
              )}
              {booked && (
                <div
                  className={
                    "space-y-2 rounded-lg px-3 py-2 " +
                    (hasResi ? "bg-emerald-500/10" : "bg-amber-500/10")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={
                        "flex items-center gap-2 text-xs font-medium " +
                        (hasResi
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-700 dark:text-amber-400")
                      }
                    >
                      <Truck className="size-4" />
                      {hasResi
                        ? "Pengiriman terdaftar"
                        : "Dibooking — belum ada resi"}
                    </span>
                    {canWrite && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={tracking}
                          onClick={trackNow}
                        >
                          {tracking ? "Melacak…" : "Lacak"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancelling}
                          onClick={cancelNow}
                          className="text-red-600 hover:text-red-600"
                        >
                          {cancelling ? "…" : "Batalkan"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {!hasResi && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Kurir menerbitkan nomor resi setelah paket
                      dijemput/diproses. Klik{" "}
                      <span className="font-medium text-foreground">Lacak</span>{" "}
                      untuk mengambilnya — label baru bisa dicetak setelah resi
                      terbit.
                    </p>
                  )}
                  {!hasResi && demoAllowed && (
                    <p className="text-[11px] leading-snug text-emerald-700 dark:text-emerald-400">
                      Mode demo: klik{" "}
                      <span className="font-medium">Cetak resi</span> untuk
                      mengisi resi contoh &amp; melihat labelnya.
                    </p>
                  )}
                </div>
              )}
              <Separator />
              {/* Destination = orders.city/province. A street is shown ONLY when the customer's
                  saved address is in that same city; otherwise we say the street is unknown. */}
              <div className="flex gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span className="leading-snug">
                  {usableAddress ? (
                    [
                      usableAddress.street,
                      usableAddress.city,
                      usableAddress.province,
                      usableAddress.postcode,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  ) : (
                    <>
                      {destination}
                      <span className="block text-xs">
                        Alamat lengkap belum tercatat untuk pesanan ini
                      </span>
                    </>
                  )}
                </span>
              </div>
              {address?.street && !address.cityMatchesOrder && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <div className="space-y-0.5 text-muted-foreground">
                    <div className="font-medium text-amber-700 dark:text-amber-400">
                      Alamat tersimpan pelanggan beda kota
                    </div>
                    <div>
                      {[address.street, address.city, address.province]
                        .filter(Boolean)
                        .join(", ")}{" "}
                      — pesanan ini tercatat dikirim ke{" "}
                      <span className="text-foreground">{destination}</span>.
                      Konfirmasi alamat ke pelanggan sebelum kirim.
                    </div>
                  </div>
                </div>
              )}
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
                {payment ? (
                  <span className="font-medium">{payment.methodLabel}</span>
                ) : (
                  <span className="text-muted-foreground">
                    Belum ada pembayaran
                  </span>
                )}
              </div>
              {payment?.virtualAccount && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Virtual Account</span>
                  <span className="font-mono text-xs font-medium">
                    {payment.virtualAccount}
                  </span>
                </div>
              )}
              {payment && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Status</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAY_STATUS[payment.status].cls}`}
                  >
                    {PAY_STATUS[payment.status].label}
                  </span>
                </div>
              )}
              {payment?.paidAtLabel && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Dibayar pada</span>
                  <span className="font-medium">{payment.paidAtLabel}</span>
                </div>
              )}
              {payment && payment.adminFee > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Total (+admin)</span>
                  <span className="font-medium tabular-nums">
                    {IDR(payment.total)}
                  </span>
                </div>
              )}
              {canBill && canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={ratePending}
                  onClick={() => setBillOpen(true)}
                >
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
                <span className="tabular-nums">{IDR(money.total)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                Rekonsiliasi
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    financial.reconciliationStatus === "cocok"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {financial.reconciliationStatus === "cocok"
                    ? "Cocok"
                    : financial.reconciliationStatus === "legacy"
                      ? "Data lama"
                      : "Ada selisih"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Hasil barang</span>
                <span className="tabular-nums">
                  {IDR(financial.goodsProceeds)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Ongkir dibayar pembeli
                </span>
                <span className="tabular-nums">
                  {IDR(financial.shippingCharged)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Biaya kurir aktual
                </span>
                <span className="tabular-nums">
                  {financial.shippingActual == null
                    ? "Belum dibooking"
                    : IDR(financial.shippingActual)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Selisih ongkir Seller
                </span>
                <span className="tabular-nums">
                  −{IDR(financial.sellerShippingDebit)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Margin ongkir TokoΦ
                </span>
                <span className="tabular-nums">
                  {IDR(financial.platformShippingMargin)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Biaya gateway</span>
                <span className="tabular-nums">
                  {IDR(financial.gatewayFeeActual)}
                </span>
              </div>
              {(financial.codFeeBeforeVat > 0 || financial.codFeeVat > 0) && (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Biaya COD</span>
                    <span className="tabular-nums">
                      {IDR(financial.codFeeBeforeVat)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">PPN biaya COD</span>
                    <span className="tabular-nums">
                      {IDR(financial.codFeeVat)}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">PPN penjualan</span>
                <span className="tabular-nums">
                  {IDR(financial.salesTaxLiability)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between gap-3 font-semibold">
                <span>Hak Seller</span>
                <span className="tabular-nums">
                  {IDR(financial.sellerEntitlement)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Total dibayar pembeli
                </span>
                <span className="tabular-nums">
                  {IDR(financial.buyerPayable)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Jumlah ledger saat ini
                </span>
                <span className="tabular-nums">{IDR(financial.ledgerSum)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  Ledger yang diharapkan
                </span>
                <span className="tabular-nums">
                  {IDR(financial.ledgerExpected)}
                </span>
              </div>
              {financial.source === "legacy" && (
                <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                  Pesanan lama tidak memiliki pembagian diskon barang/ongkir.
                  Nilai historis tidak diubah otomatis.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Cek Ongkir (KiriminAja live rates) */}
      <Dialog open={rateOpen} onOpenChange={setRateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Ongkir — {rateMeta.destination?.split(",")[0] ?? order.city}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {rateMeta.origin?.split(",")[0]} →{" "}
            {rateMeta.destination?.split(",")[0]} · ongkir real-time
          </p>
          {canWrite && !booked && (
            <div className="mt-1 flex items-center gap-4 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={insureShipment}
                  onChange={(e) => setInsureShipment(e.target.checked)}
                  className="size-4 accent-primary"
                />{" "}
                Asuransi
              </label>
              {codAvailable && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={codShipment}
                    disabled
                    readOnly
                    className="size-4 accent-primary"
                  />{" "}
                  {isCod
                    ? `COD — kurir menagih ${IDR(money.total)}`
                    : "Sudah dibayar di muka — kurir tidak menagih"}
                </label>
              )}
            </div>
          )}
          {/* The booking blocker the merchant can actually fix. Stays on screen until resolved —
              a toast that vanishes is not an error message for a setup problem. */}
          {senderError && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
              <div className="space-y-1.5 text-muted-foreground">
                <div className="font-medium text-red-600 dark:text-red-400">
                  Pengiriman tidak bisa dibuat — alamat pengirim belum lengkap
                </div>
                <div>{senderError}</div>
                <div>
                  Kurir menjemput paket dari alamat ini, jadi KiriminAja menolak
                  booking tanpa{" "}
                  <span className="font-medium text-foreground">kecamatan</span>
                  .
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/pengaturan" />}
                >
                  <MapPin className="size-4" /> Buka Pengaturan → Alamat
                </Button>
              </div>
            </div>
          )}
          <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Layanan</th>
                  <th className="px-3 py-2 font-medium">Estimasi</th>
                  <th className="px-3 py-2 text-right font-medium">Ongkir</th>
                  {canWrite && !booked && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rates.map((r, i) => {
                  // Only on rates whose EFFECTIVE cod flag is true — a fee for an option that is not
                  // offered would read as a charge on a service that cannot incur it.
                  const codFee = r.cod ? codFeeLabel(r.codFee) : null;
                  return (
                    <tr key={r.service + i} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">
                        {r.service}
                        {r.cod && (
                          <span className="ml-1.5 rounded bg-emerald-500/12 px-1 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            COD
                          </span>
                        )}
                        {codFee && (
                          <div className="text-[11px] font-normal text-muted-foreground">
                            {codFee}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.etd} hari
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {IDR(r.cost)}
                      </td>
                      {canWrite && !booked && (
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={ratePending || (codShipment && !r.cod)}
                            title={
                              codShipment && !r.cod
                                ? "Layanan ini tidak mendukung COD"
                                : ""
                            }
                            onClick={() => {
                              setRateOpen(false);
                              setConfirmRate(r);
                            }}
                          >
                            Pilih
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {rates.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      Tidak ada layanan untuk rute ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {rates.length} layanan · tarif real-time · dikelola TokoΦ.
          </p>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmRate}
        onOpenChange={(open) => !open && setConfirmRate(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Konfirmasi biaya pengiriman</DialogTitle>
          </DialogHeader>
          {confirmRate && (
            <div className="space-y-4 text-sm">
              <div className="space-y-2 rounded-lg border p-4">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Dibayar pembeli</span>
                  <span className="font-medium tabular-nums">
                    {IDR(financial.shippingCharged)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    {confirmRate.service}
                  </span>
                  <span className="font-medium tabular-nums">
                    {IDR(confirmRate.cost)}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Selisih</span>
                  <span className="font-medium tabular-nums">
                    {confirmDelta > 0 ? "+" : ""}
                    {IDR(confirmDelta)}
                  </span>
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  {confirmDebit > 0
                    ? `${IDR(confirmDebit)} dipotong dari hasil pesanan Seller; kekurangannya memakai saldo tersedia.`
                    : confirmMargin > 0
                      ? `${IDR(confirmMargin)} menjadi margin pengiriman TokoΦ dan tidak masuk saldo Seller.`
                      : "Tidak ada selisih biaya pengiriman."}
                </div>
                <div className="flex justify-between gap-3 font-semibold">
                  <span>Hak Seller setelah ongkir</span>
                  <span className="tabular-nums">
                    {IDR(confirmEntitlement)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Tarif diverifikasi ulang di server saat booking. Jika berubah,
                booking ditolak sebelum kurir dipanggil.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmRate(null);
                    setRateOpen(true);
                  }}
                >
                  Kembali
                </Button>
                <Button
                  disabled={ratePending || !canBookShipment}
                  onClick={() => makeShipment(confirmRate)}
                >
                  {makingRate ? "Membooking…" : "Konfirmasi & booking"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lacak — the REAL KiriminAja tracking response. When there is no movement yet we say
          exactly that, instead of inventing a "Paket sedang dalam perjalanan" line. */}
      <Dialog open={trackOpen} onOpenChange={setTrackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Lacak pengiriman — {order.id}</DialogTitle>
          </DialogHeader>
          {track && (
            <div className="space-y-3 text-sm">
              <div className="space-y-1.5 rounded-lg border p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Kurir</span>
                  <span className="font-medium">{shipment.courier ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">No. resi</span>
                  {track.awb ? (
                    <span className="font-mono font-medium">{track.awb}</span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">
                      Belum diterbitkan kurir
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Ref. booking</span>
                  <span className="font-mono text-muted-foreground">
                    {track.kaOrderId ?? "—"}
                  </span>
                </div>
                {track.status && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-medium">{track.status}</span>
                  </div>
                )}
              </div>

              <div
                className={
                  "rounded-lg border p-3 text-xs leading-snug " +
                  (track.ok
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-amber-500/30 bg-amber-500/5")
                }
              >
                {track.message}
              </div>

              {track.history.length > 0 ? (
                <ol className="space-y-2">
                  {[...track.history].reverse().map((h, i) => (
                    <li key={i} className="flex gap-2.5">
                      <div className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                      <div className="leading-snug">
                        <div className="text-sm">{h.desc || "—"}</div>
                        {h.date && (
                          <div className="text-xs text-muted-foreground">
                            {h.date}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Belum ada riwayat perjalanan dari kurir untuk pengiriman ini.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Tandai retur (parcel came back) */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tandai retur — {order.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-orange-500/25 bg-orange-500/5 p-3 text-sm text-muted-foreground">
              Paket dianggap kembali ke gudang. Stok {totalQty} item akan{" "}
              <span className="font-medium text-foreground">
                ditambahkan kembali
              </span>{" "}
              dan tagihan yang masih menunggu akan{" "}
              <span className="font-medium text-foreground">
                ditandai gagal
              </span>
              . Tindakan ini tidak bisa dibatalkan dari sini.
            </div>
            <div className="space-y-1.5">
              <label htmlFor="return-reason" className="text-sm font-medium">
                Alasan retur
              </label>
              <Textarea
                id="return-reason"
                rows={3}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder={DEFAULT_RETURN_REASON}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setReturnOpen(false)}
              >
                Batal
              </Button>
              <Button disabled={pending} onClick={markReturned}>
                <Undo2 /> {pending ? "Menyimpan…" : "Tandai retur"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Buat Tagihan (create a payment bill) */}
      <Dialog open={billOpen} onOpenChange={setBillOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Buat Tagihan — {order.id}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Pilih metode pembayaran. Nomor VA / QRIS terbit otomatis untuk{" "}
            {IDR(money.total)}.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PAY_CHANNELS.map((c) => (
              <Button
                key={c.code}
                variant="outline"
                disabled={ratePending}
                onClick={() => createBill(c.code)}
              >
                {c.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
