// Client-safe half of the affiliate commission lifecycle — ONE definition shared by the Affiliate screen
// and the Pesanan list/detail. (`lib/data/affiliates.ts` is server-only, so a "use client" file cannot
// import from it; same split as order-list-types.ts.)

/** Display state of a commission. `siap` and `ditahan` are DERIVED from `eligible_at`, never stored. */
export type CommissionState = "belum_selesai" | "ditahan" | "siap" | "dibayar" | "batal";

export function commissionState(c: {
  status: "pending" | "dibayar" | "batal";
  /** pending AND eligible_at is set AND eligible_at <= now() — computed by the same SQL everywhere. */
  isReady: boolean;
  hasEligibleAt: boolean;
}): CommissionState {
  if (c.status === "dibayar") return "dibayar";
  if (c.status === "batal") return "batal";
  if (c.isReady) return "siap";
  return c.hasEligibleAt ? "ditahan" : "belum_selesai";
}

export const COMMISSION_STATE: Record<CommissionState, { label: string; className: string }> = {
  belum_selesai: { label: "Pesanan berjalan", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  ditahan: { label: "Masa retur", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  siap: { label: "Siap dibayar", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  dibayar: { label: "Dibayar", className: "bg-muted text-muted-foreground" },
  batal: { label: "Batal", className: "bg-muted text-muted-foreground line-through" },
};
