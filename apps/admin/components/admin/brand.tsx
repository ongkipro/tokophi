import { Store } from "lucide-react";
import { cn } from "@tokophi/ui/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Store className="size-[18px]" />
      </div>
      <div className="leading-none">
        <div className="font-semibold tracking-tight">TokoΦ</div>
        <div className="text-[11px] text-muted-foreground">Panel Admin</div>
      </div>
    </div>
  );
}
