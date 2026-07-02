// Small, server-safe display helpers shared across platform pages.
import { UserPlus, ArrowUpRight, CreditCard, TrendingDown, LifeBuoy, ArrowUp, ArrowDown, type LucideIcon } from "lucide-react";
import { Badge } from "@indostore/ui/badge";
import { cn } from "@indostore/ui/lib/utils";
import type { Plan, StoreStatus, PActivity, InvoiceStatus } from "@/lib/mock";

// Initials from a person or store name, e.g. "Batik Nusantara" -> "BN".
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

const PLAN_STYLES: Record<Plan, string> = {
  pemula: "bg-muted text-foreground",
  bisnis: "bg-primary/12 text-primary",
  skala: "bg-chart-3/15 text-chart-3",
};

export function PlanBadge({ plan, className }: { plan: Plan; className?: string }) {
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);
  return (
    <Badge variant="secondary" className={cn("border-transparent capitalize", PLAN_STYLES[plan], className)}>
      {label}
    </Badge>
  );
}

const STATUS_STYLES: Record<StoreStatus, string> = {
  aktif: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  trial: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  ditangguhkan: "bg-destructive/12 text-destructive",
};

const STATUS_LABEL: Record<StoreStatus, string> = {
  aktif: "Aktif",
  trial: "Trial",
  ditangguhkan: "Ditangguhkan",
};

export function StatusBadge({ status, className }: { status: StoreStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", STATUS_STYLES[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const INVOICE_STYLES: Record<InvoiceStatus, string> = {
  dibayar: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  menunggu: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  gagal: "bg-destructive/12 text-destructive",
};
const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  dibayar: "Dibayar",
  menunggu: "Menunggu",
  gagal: "Gagal",
};

export function InvoiceBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", INVOICE_STYLES[status], className)}>
      {INVOICE_LABEL[status]}
    </Badge>
  );
}

// Delta chip: ▲/▼ with green(good)/red(bad) coloring. `invert` = down is good (e.g. churn).
export function Delta({
  value,
  invert = false,
  unit = "%",
  className,
}: {
  value: number;
  invert?: boolean;
  unit?: string;
  className?: string;
}) {
  const up = value >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
        good
          ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
          : "bg-destructive/12 text-destructive",
        className,
      )}
    >
      <Icon className="size-3" />
      {up ? "+" : "−"}
      {Math.abs(value)}
      {unit}
    </span>
  );
}

const ACTIVITY_META: Record<PActivity["kind"], { icon: LucideIcon; tint: string }> = {
  signup: { icon: UserPlus, tint: "bg-primary/10 text-primary" },
  upgrade: { icon: ArrowUpRight, tint: "bg-chart-3/15 text-chart-3" },
  payment: { icon: CreditCard, tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  churn: { icon: TrendingDown, tint: "bg-destructive/12 text-destructive" },
  support: { icon: LifeBuoy, tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
};

export function ActivityIcon({ kind }: { kind: PActivity["kind"] }) {
  const { icon: Icon, tint } = ACTIVITY_META[kind];
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", tint)}>
      <Icon className="size-4" />
    </span>
  );
}
