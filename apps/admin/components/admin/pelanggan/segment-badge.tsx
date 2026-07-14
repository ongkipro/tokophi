import { Badge } from "@tokophi/ui/badge";
import { cn } from "@tokophi/ui/lib/utils";
import type { Segment } from "@/lib/mock/store";

export const SEGMENTS: Record<Segment, { label: string; cls: string; dot: string }> = {
  baru: {
    label: "Baru",
    cls: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  reguler: {
    label: "Reguler",
    cls: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  loyal: {
    label: "Loyal",
    cls: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  vip: {
    label: "VIP",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
};

export function SegmentBadge({ segment, className }: { segment: Segment; className?: string }) {
  const s = SEGMENTS[segment];
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", s.cls, className)}>
      {s.label}
    </Badge>
  );
}
