// Static config + shared types for the SUPER ADMIN (platform control plane).
// Live data now comes from the database via lib/data.ts (@tokophi/db); this file only
// holds the plan catalog + the UI-facing types the components share.

import type { StoreSegment } from "@tokophi/lib/billing";

export type Plan = "pemula" | "bisnis" | "skala";
export type StoreStatus = "aktif" | "trial" | "ditangguhkan" | "menunggak";

export type Store = {
  id: string;
  name: string;
  owner: string;
  email: string;
  city: string;
  plan: Plan;
  status: StoreStatus;
  segment: StoreSegment; // billing lifecycle: trial | first_month | regular | vip
  comped: boolean; // VIP: billing bypassed
  gmv: number; // total transaction value (IDR)
  orders: number;
  products: number;
  ship7d: number; // avg shipments/day, last 7 days
  createdDaysAgo: number;
};

// ---- plans (subscription tiers — config) ----
export type PlanInfo = { key: Plan; name: string; price: number; blurb: string; features: string[] };
export const PLANS: PlanInfo[] = [
  { key: "pemula", name: "Pemula", price: 99_000, blurb: "Untuk toko baru", features: ["1 toko", "Produk tak terbatas", "Fitur inti", "Support email"] },
  { key: "bisnis", name: "Bisnis", price: 299_000, blurb: "Untuk toko berkembang", features: ["Multi-toko", "Analitik lanjutan", "Pemasaran & iklan", "CRM WhatsApp", "Support prioritas"] },
  { key: "skala", name: "Skala", price: 799_000, blurb: "Untuk volume tinggi", features: ["Semua fitur Bisnis", "API akses", "Multi-lokasi", "Peran lanjutan", "Account manager"] },
];

export const planName = (k: Plan) => PLANS.find((p) => p.key === k)?.name ?? k;
export const planPrice = (k: Plan) => PLANS.find((p) => p.key === k)?.price ?? 0;

// ---- shared display types ----
export type InvoiceStatus = "dibayar" | "menunggu" | "gagal";
export type Invoice = { id: string; store: string; plan: Plan; amount: number; status: InvoiceStatus; daysAgo: number };

export type PActivity = { id: string; kind: "signup" | "upgrade" | "payment" | "churn" | "support" | "admin"; text: string; minutesAgo: number };
