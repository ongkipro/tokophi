import { Store } from "lucide-react";
import { cn } from "@tokophi/ui/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Store className="size-[18px]" />
      </div>
      {/* leading-tight, NOT leading-none: the Φ (U+03A6) rises above the Latin cap height, and a
          line-height of exactly 1 clipped its top on the wordmark. */}
      <div className="leading-tight">
        <div className="font-semibold tracking-tight">TokoΦ</div>
        <div className="text-[11px] text-muted-foreground">Dashboard Seller</div>
      </div>
    </div>
  );
}
