import { Badge } from "@tokophi/ui/badge";
import { cn } from "@tokophi/ui/lib/utils";
import type { OrderStatus } from "@/lib/mock/store";

const MAP: Record<OrderStatus, { label: string; cls: string }> = {
  baru: { label: "Baru", cls: "bg-blue-500/12 text-blue-600 dark:text-blue-400" },
  diproses: { label: "Diproses", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  dikirim: { label: "Dikirim", cls: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  selesai: { label: "Selesai", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  batal: { label: "Batal", cls: "bg-red-500/12 text-red-600 dark:text-red-400" },
  // Deliberately NOT the same colour as Batal: a cancelled order never shipped, a returned one did
  // and somebody paid to move it twice. Orange reads as "costly", which is the point.
  retur: { label: "Retur", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = MAP[status];
  return <Badge variant="secondary" className={cn("border-0 font-medium", s.cls)}>{s.label}</Badge>;
}
