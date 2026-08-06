"use client";
import Link from "next/link";
import { Loader2, MapPin, Phone, Truck, User } from "lucide-react";
import { Button } from "@tokophi/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@tokophi/ui/dialog";
import { Separator } from "@tokophi/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { OrderStatusBadge } from "@/components/admin/order-status";
import type { InvoiceDetail } from "@/lib/data/ledger";
import { IDR } from "@tokophi/lib/format";
import type { OrderStatus } from "@/lib/mock/store";

const dt = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(d);

/**
 * What is actually behind a held invoice.
 *
 * The merchant's question is never "how much is held" — the card above already says that. It is
 * "which parcel is this, who is waiting for it, and what is in the box", because that decides
 * whether they chase the courier or call the buyer. So: real customer, real phone, real destination,
 * real variants (Hitam / M · qty · harga) straight out of order_line_items ⋈ product_variants.
 *
 * Purely presentational: the row's "Rincian" button fetches on click (20 invoices × their line
 * items on every page render would be a join nobody asked for) and hands the result down here.
 */
export function InvoiceDialog({
  number,
  data,
  loading,
  open,
  onOpenChange,
}: {
  number: string | null;
  data: InvoiceDetail | null;
  loading: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const place = data ? [data.address, data.city, data.province, data.postcode].filter(Boolean).join(", ") : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="font-mono">{number ?? "Invoice"}</span>
            {data && <OrderStatusBadge status={data.status as OrderStatus} />}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat invoice…
          </div>
        )}

        {!loading && !data && (
          <p className="py-10 text-center text-sm text-muted-foreground">Invoice tidak ditemukan.</p>
        )}

        {data && (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto">
            <p className="text-xs text-muted-foreground">Dipesan {dt(data.placedAt)}</p>

            {/* Pembeli + tujuan */}
            <div className="grid gap-3 rounded-xl border p-3 text-sm sm:grid-cols-2">
              <div className="flex gap-2.5">
                <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium">{data.customer ?? "Pelanggan tanpa nama"}</div>
                  {data.email && <div className="truncate text-xs text-muted-foreground">{data.email}</div>}
                </div>
              </div>
              <div className="flex gap-2.5">
                <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="tabular-nums">{data.phone ?? <span className="text-muted-foreground">—</span>}</div>
              </div>
              <div className="flex gap-2.5 sm:col-span-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="leading-snug">
                  {place || <span className="text-muted-foreground">Alamat belum tercatat</span>}
                </div>
              </div>
              {(data.courier || data.awb) && (
                <div className="flex gap-2.5 sm:col-span-2">
                  <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="leading-snug">
                    {data.courier ?? "Kurir"}{" "}
                    {data.awb && <span className="font-mono text-xs text-muted-foreground">· {data.awb}</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Isi paket — varian yang dibeli */}
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Produk</TableHead>
                  <TableHead>Varian</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Harga</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((l) => (
                  <TableRow key={l.id} className="hover:bg-transparent">
                    <TableCell className="max-w-xs"><span className="line-clamp-2 whitespace-normal break-words font-medium" title={l.product}>{l.product}</span></TableCell>
                    <TableCell className="text-muted-foreground">{l.variant ?? "—"}</TableCell>
                    <TableCell className="text-center tabular-nums">{l.qty}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{IDR(l.price)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{IDR(l.total)}</TableCell>
                  </TableRow>
                ))}
                {data.lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      Tidak ada item tercatat.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="ml-auto max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{IDR(data.subtotal)}</span>
              </div>
              {data.discount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Diskon</span>
                  <span className="tabular-nums">− {IDR(data.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Ongkos kirim</span>
                <span className="tabular-nums">{data.shipping === 0 ? "Gratis" : IDR(data.shipping)}</span>
              </div>
              {/* Inclusive PPN is already inside subtotal (base == total) → label "Termasuk"; exclusive
                  adds on top. Without this the breakdown didn't sum once an order carried PPN. */}
              {data.tax > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{data.subtotal - data.discount + data.shipping === data.total ? "Termasuk PPN" : "PPN"}</span>
                  <span className="tabular-nums">{IDR(data.tax)}</span>
                </div>
              )}
              <Separator className="my-1.5" />
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{IDR(data.total)}</span>
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/pesanan/${data.number}`} />}>
                Buka pesanan
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
