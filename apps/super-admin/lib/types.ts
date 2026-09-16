// Shared UI-facing types for the SUPER ADMIN (platform control plane).
//
// This file used to be `lib/mock.ts` and carried a hand-written plan catalogue (Pemula/Bisnis/
// Skala). Those tiers are LEGACY and forbidden (CLAUDE.md: one plan, "TokoΦ"); they were dead code
// feeding a `getPlanDistribution()` nothing rendered. Removed. What is left is types only — every
// value now comes from `lib/data.ts` (real queries).

import type { StoreSegment } from "@tokophi/lib/billing";

export type StoreStatus = "aktif" | "trial" | "ditangguhkan" | "menunggak";

export type Store = {
  id: string;
  name: string;
  owner: string;
  email: string;
  city: string;
  status: StoreStatus;
  segment: StoreSegment; // billing lifecycle: trial | first_month | regular | vip
  comped: boolean; // VIP: billing bypassed
  isDemo: boolean; // seeded demo store (stores.is_demo, 8.27) — shown in the list, excluded from every money KPI
  // An OPERATOR suspended this store (stores.suspended_at), as opposed to `status === "ditangguhkan"`
  // which is also what an unpaid store reads once its grace period lapses. Never derive "did we
  // suspend this?" from the status badge — that is what made the Aktifkan button un-pressable.
  operatorSuspended: boolean;
  // Locked because it came in through self-serve signup and nobody has reviewed it yet (0090) —
  // NOT because an operator judged it. Both are `operatorSuspended`; only this separates them.
  pendingApproval: boolean;
  // --- all four derived from `orders` / `products`, never from the store_stats rollup ---
  gmv: number; // Σ orders.total_idr, excluding batal (IDR) — the MERCHANT's money, not ours
  orders: number; // count(orders) excluding batal
  orders30d: number; // count(orders) in the last 30 days — the real activity signal
  products: number; // count(products where status = 'active')
  lastOrderDays: number | null; // days since the last order; null = never ordered (dormancy)
  createdDaysAgo: number;
};

// ---- shared display types ----
export type InvoiceStatus = "dibayar" | "menunggu" | "gagal";
export type Invoice = { id: string; store: string; amount: number; status: InvoiceStatus; daysAgo: number };

export type PActivity = { id: string; kind: "signup" | "upgrade" | "payment" | "churn" | "support" | "admin"; text: string; minutesAgo: number };
