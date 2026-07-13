// Small, server-safe display helpers shared across platform pages.
import { UserPlus, ArrowUpRight, CreditCard, TrendingDown, LifeBuoy, ShieldCheck, type LucideIcon } from "lucide-react";
import { Badge } from "@tokophi/ui/badge";
import { cn } from "@tokophi/ui/lib/utils";
import { IDR } from "@tokophi/lib/format";
import type { StoreStatus, PActivity, InvoiceStatus } from "@/lib/types";
import type { RiskReason } from "@/lib/data";
import { type HealthVerdict, verdictMeta } from "@/lib/health-types";
import { SEGMENT_META, type StoreSegment } from "@tokophi/lib/billing";

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

const STATUS_STYLES: Record<StoreStatus, string> = {
  aktif: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  trial: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  menunggak: "bg-orange-500/12 text-orange-600 dark:text-orange-400",
  ditangguhkan: "bg-destructive/12 text-destructive",
};

const STATUS_LABEL: Record<StoreStatus, string> = {
  aktif: "Aktif",
  trial: "Trial",
  menunggak: "Menunggak",
  ditangguhkan: "Ditangguhkan",
};

export function StatusBadge({ status, className }: { status: StoreStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", STATUS_STYLES[status], className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

// Billing lifecycle segment (the 4 sessions): trial → first_month → regular → vip.
const SEGMENT_STYLES: Record<StoreSegment, string> = {
  trial: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  first_month: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  regular: "bg-primary/10 text-primary",
  vip: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};
export function SegmentBadge({ segment, className }: { segment: StoreSegment; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", SEGMENT_STYLES[segment], className)}>
      {SEGMENT_META[segment].short}
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

const VERDICT_STYLES: Record<HealthVerdict, string> = {
  sehat: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  perhatian: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  bermasalah: "bg-destructive/12 text-destructive",
};

// Composite store-health badge (Sehat / Perhatian / Bermasalah) — a colored dot + label.
export function HealthBadge({ verdict, className }: { verdict: HealthVerdict; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5 border-transparent", VERDICT_STYLES[verdict], className)}>
      <span className="size-1.5 rounded-full bg-current" />
      {verdictMeta[verdict].label}
    </Badge>
  );
}

const ACTIVITY_META: Record<PActivity["kind"], { icon: LucideIcon; tint: string }> = {
  signup: { icon: UserPlus, tint: "bg-primary/10 text-primary" },
  upgrade: { icon: ArrowUpRight, tint: "bg-chart-3/15 text-chart-3" },
  payment: { icon: CreditCard, tint: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  churn: { icon: TrendingDown, tint: "bg-destructive/12 text-destructive" },
  support: { icon: LifeBuoy, tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
  admin: { icon: ShieldCheck, tint: "bg-chart-3/15 text-chart-3" },
};

export function ActivityIcon({ kind }: { kind: PActivity["kind"] }) {
  const { icon: Icon, tint } = ACTIVITY_META[kind];
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", tint)}>
      <Icon className="size-4" />
    </span>
  );
}

// One reason a store is on the operator's worklist. Each chip states the FACT, not a verdict —
// "ditangguhkan 2 hari lagi", not "berisiko". An operator can act on the first and not the second.
const RISK_TONE = {
  red: "bg-destructive/12 text-destructive",
  orange: "bg-orange-500/12 text-orange-600 dark:text-orange-400",
  amber: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  slate: "bg-muted text-muted-foreground",
} as const;

function riskLabel(r: RiskReason): { text: string; tone: keyof typeof RISK_TONE } {
  switch (r.kind) {
    case "suspended":
      return { text: "Ditangguhkan — toko read-only", tone: "red" };
    case "grace":
      return { text: `Ditangguhkan ${r.daysLeft} hari lagi`, tone: "red" };
    case "failed_invoice":
      return { text: `${r.count} tagihan GAGAL · ${IDR(r.amount)}`, tone: "red" };
    case "unpaid_invoice":
      return { text: `${r.count} tagihan belum dibayar · ${IDR(r.amount)}${r.oldestDays ? ` (${r.oldestDays}h)` : ""}`, tone: "orange" };
    case "trial_ending":
      return { text: `Trial berakhir ${r.daysLeft} hari lagi`, tone: "amber" };
    case "never_ordered":
      return { text: "Belum pernah ada pesanan", tone: "amber" };
    case "dormant":
      return { text: `Tidak ada pesanan ${r.days} hari`, tone: "slate" };
  }
}

export function RiskReasonChip({ reason }: { reason: RiskReason }) {
  const { text, tone } = riskLabel(reason);
  return (
    <Badge variant="secondary" className={cn("border-transparent text-[11px] font-medium", RISK_TONE[tone])}>
      {text}
    </Badge>
  );
}
