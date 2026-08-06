import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tokophi/ui/table";
import { Avatar, AvatarFallback } from "@tokophi/ui/avatar";
import { OrderStatusBadge } from "./order-status";
import type { Order } from "@/lib/mock/store";
import { IDR, timeAgo } from "@tokophi/lib/format";

export function RecentOrders({ orders }: { orders: Order[] }) {
  // A brand-new store rendered this as a HEADER-ONLY table: five column labels over nothing, which
  // reads as "the data failed to load" rather than "you have no orders yet". Same rule the sibling
  // cards on this dashboard already follow ("Belum ada penjualan pada periode ini.") — say what is
  // missing and what brings it.
  if (orders.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Belum ada pesanan. Pesanan pertama muncul di sini begitu ada pembeli yang checkout di storefront Anda.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Pelanggan</TableHead>
          <TableHead className="hidden sm:table-cell">Invoice</TableHead>
          <TableHead className="hidden md:table-cell">Channel</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow key={o.id}>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-muted text-[11px] font-medium">
                    {o.customer.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <Link href={`/pesanan/${o.id.replace(/^#/, "")}`} className="block truncate text-sm font-medium hover:underline">
                    {o.customer}
                  </Link>
                  <div className="text-xs text-muted-foreground">{o.city} · {timeAgo(o.minutesAgo)}</div>
                </div>
              </div>
            </TableCell>
            <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{o.id}</TableCell>
            <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{o.channel}</TableCell>
            <TableCell><OrderStatusBadge status={o.status} /></TableCell>
            <TableCell className="text-right font-medium tabular-nums">{IDR(o.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
