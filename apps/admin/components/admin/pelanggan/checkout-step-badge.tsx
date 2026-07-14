import { Badge } from "@tokophi/ui/badge";
import { cn } from "@tokophi/ui/lib/utils";
import type { CheckoutStep } from "@/lib/data/checkout";

// How far the shopper got before leaving (`checkout_sessions.step`). The further right, the hotter
// the cart: someone who reached "Pembayaran" had their wallet open.
export const STEP_META: Record<CheckoutStep, { label: string; cls: string }> = {
  keranjang: { label: "Keranjang", cls: "bg-slate-500/12 text-slate-600 dark:text-slate-300" },
  kontak: { label: "Kontak", cls: "bg-blue-500/12 text-blue-600 dark:text-blue-400" },
  alamat: { label: "Alamat", cls: "bg-violet-500/12 text-violet-600 dark:text-violet-400" },
  pengiriman: { label: "Pengiriman", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  pembayaran: { label: "Pembayaran", cls: "bg-rose-500/12 text-rose-600 dark:text-rose-400" },
};

export function CheckoutStepBadge({ step, className }: { step: CheckoutStep; className?: string }) {
  const s = STEP_META[step];
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", s.cls, className)}>
      {s.label}
    </Badge>
  );
}
