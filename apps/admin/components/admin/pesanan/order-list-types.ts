// Client-safe half of the Pesanan list contract: types + label tables the UI needs.
//
// It lives HERE and not in `lib/data/orders.ts` for one hard reason: that module is `server-only`,
// so importing a constant from it into a `"use client"` file drags the whole DB/auth chain into the
// browser bundle and the build fails. Same split as `lib/rbac-policy.ts` (client-safe) vs
// `lib/rbac.ts` (server). `lib/data/orders.ts` re-exports these so server code has one import.

export type OrderTab = "semua" | "belum_bayar" | "perlu_dikirim" | "dikirim" | "selesai" | "pengembalian";
export type OrderSearchField = "no" | "pembeli" | "produk" | "resi";

export const ORDER_TABS: { value: OrderTab; label: string }[] = [
  { value: "semua", label: "Semua" },
  { value: "belum_bayar", label: "Belum Bayar" },
  { value: "perlu_dikirim", label: "Perlu Dikirim" },
  { value: "dikirim", label: "Dikirim" },
  { value: "selesai", label: "Selesai" },
  { value: "pengembalian", label: "Pengembalian/Pembatalan" },
];

export const ORDER_SEARCH_FIELDS: { value: OrderSearchField; label: string; placeholder: string }[] = [
  { value: "no", label: "No. Pesanan", placeholder: "Cari no. pesanan…" },
  { value: "pembeli", label: "Nama Pembeli", placeholder: "Cari nama pembeli…" },
  { value: "produk", label: "Produk", placeholder: "Cari nama produk…" },
  { value: "resi", label: "No. Resi", placeholder: "Cari no. resi…" },
];

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  transfer: "Transfer Bank", qris: "QRIS", ovo: "OVO", gopay: "GoPay",
  dana: "DANA", va: "Virtual Account", cod: "COD (Bayar di Tempat)",
};

/**
 * The `payment_method` enum's values, derived from the labels above so the two cannot drift.
 *
 * Exists because `/pesanan?bayar=<anything>` used to reach `p.method = $1::payment_method` unvalidated
 * and answer **500** — while `tab` and `field`, the two parameters beside it, were both checked.
 */
export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABEL);

export type OrderListLine = {
  title: string;
  variant: string | null;
  qty: number;
  image: string | null;
  emoji: string | null;
};

export type OrderListRow = {
  id: string;            // "#INV-4819"
  number: string;        // "INV-4819"
  buyer: string;         // ship_recipient snapshot (migration 0042), customer name as fallback
  city: string;
  address: string | null;
  total: number;
  sellerEntitlement: number;
  goodsDiscount: number;
  shippingDiscount: number;
  allocationLegacy: boolean;
  paymentMethod: string | null;  // payments.method, null when the order has no payment row
  paid: boolean;                 // financial_status = 'dibayar'
  status: "baru" | "diproses" | "dikirim" | "selesai" | "batal" | "retur";
  courier: string | null;
  awb: string | null;
  // The courier flagged this parcel (orders.problem_at, 0062). NULL = nothing known to be wrong.
  // Set by the tracking poller and cleared again as soon as the parcel moves, so a badge built on it
  // means "stuck NOW", not "was ever stuck". Not a status: the order is still `dikirim`.
  problem: boolean;
  problemNote: string | null;
  minutesAgo: number;            // computed on the server — no clock in the render path
  lines: OrderListLine[];        // first 2, for the product-led row
  lineCount: number;
  totalQty: number;
};

export type OrderTabCounts = Record<OrderTab, number>;

export type OrderListResult = {
  rows: OrderListRow[];
  counts: OrderTabCounts;   // respect search + courier + method, so each count === rows on that tab
  total: number;            // rows on the ACTIVE tab, after filters
  page: number;
  pageCount: number;
  pageSize: number;
  couriers: string[];                                  // distinct orders.courier — near-empty today
  methods: { value: string; label: string; count: number }[];
};
