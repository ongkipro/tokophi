// Buyer-facing words for order facts (the hub, the detail page, the receipt). Plain Indonesian, never
// the Seller's internal vocabulary. Badge classes are the prototype's (`prototype.css` .badge.*).
import { waLink } from "@tokophi/lib/format";
import { returnWindowLine } from "@tokophi/lib/return-window";
import { STATUS_TABS, isUnpaid, type OrderFilter, type StatusTab } from "../data/orders";

export const ORDER_STATUS: Record<string, { label: string; badge: string }> = {
  baru: { label: "Pesanan baru", badge: "warning" },
  diproses: { label: "Sedang diproses", badge: "processing" },
  dikirim: { label: "Dalam pengiriman", badge: "shipped" },
  selesai: { label: "Pesanan selesai", badge: "done" },
  batal: { label: "Pesanan dibatalkan", badge: "guest" },
  retur: { label: "Pengembalian barang diproses", badge: "processing" },
};
const UNPAID = { label: "Menunggu pembayaran", badge: "warning" };

/** The one status a buyer reads first: an owed prepaid payment outranks the fulfilment state. */
export const statusOf = (x: { status: string; payment: { method: string; status: string } | null }) =>
  isUnpaid(x) ? UNPAID : (ORDER_STATUS[x.status] ?? { label: x.status, badge: "guest" });

export const PAYMENT_METHOD: Record<string, string> = {
  transfer: "Transfer bank",
  va: "Virtual account",
  qris: "QRIS",
  ovo: "OVO",
  gopay: "GoPay",
  dana: "DANA",
  cod: "Bayar di tempat (COD)",
};

export const PAYMENT_STATUS: Record<string, string> = {
  menunggu: "Menunggu pembayaran",
  berhasil: "Pembayaran berhasil",
  gagal: "Pembayaran gagal",
};

const COURIER: Record<string, string> = { jne: "JNE", jnt: "J&T", sicepat: "SiCepat", spx: "SPX", anteraja: "AnterAja", pos: "POS Indonesia", ninja: "Ninja Xpress", idexpress: "ID Express", lion: "Lion Parcel", sap: "SAP" };
/** The WhatsApp text that opens a return / complaint chat. The buyer can edit it before sending; it names
 *  the order and prompts the proof marketplaces ask for, and promises nothing on the store's behalf. */
export const returnRequestMessage = (storeName: string, orderNumber: string) =>
  `Halo ${storeName}, saya ingin mengajukan retur/komplain untuk pesanan ${orderNumber}.\nMasalahnya: \nFoto/video barangnya akan saya lampirkan di chat ini.`;

/** Goods are on their way or delivered: the only states where a return or complaint can start. */
export const isOnItsWay = (status: string) => status === "dikirim" || status === "selesai";

/** The complaint hand-off link (RR-10): any order on its way or delivered, whatever window the store
 *  declared, but only when the store has a WhatsApp number on file. */
export function complaintLink(o: { status: string; storeWhatsapp: string | null; storeName: string; number: string }): string | null {
  return isOnItsWay(o.status) && o.storeWhatsapp ? waLink(o.storeWhatsapp, returnRequestMessage(o.storeName, o.number)) : null;
}

/** The store's declared return window as one sentence (ACC-16): only once goods are on their way, and only if declared. */
export const returnLineFor = (o: { status: string; returnWindowDays: number | null }): string | null =>
  isOnItsWay(o.status) ? returnWindowLine(o.returnWindowDays) : null;

export const courierName = (c: string | null) => (c ? (COURIER[c.toLowerCase()] ?? c.toUpperCase()) : null);

/** The order's next fact, as the hub card's link label and where it leads. */
export function nextStep(x: { number: string; status: string; courier: string | null; awb: string | null; payment: { method: string; status: string } | null }) {
  const base = `/orders/${encodeURIComponent(x.number)}`;
  if (isUnpaid(x)) return { label: "Selesaikan pembayaran", href: `${base}#pembayaran` };
  if (x.status === "dikirim" && x.awb) return { label: `Lacak: ${[courierName(x.courier), x.awb].filter(Boolean).join(" ")}`, href: `${base}#pengiriman` };
  if (x.status === "baru" || x.status === "diproses" || x.status === "dikirim") return { label: "Lihat perkembangan", href: `${base}#pengiriman` };
  return { label: "Lihat rincian pesanan", href: base };
}

/** `?q=&toko=&status=` → a filter the data layer can trust (unknown status = `semua`). */
export function parseOrderFilter(params: URLSearchParams): Required<OrderFilter> {
  const status = params.get("status") ?? "semua";
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    toko: (params.get("toko") ?? "").trim().slice(0, 100),
    status: (STATUS_TABS as readonly string[]).includes(status) ? (status as StatusTab) : "semua",
  };
}

export const when = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
export const whenLong = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
export const whenTime = (d: Date) =>
  d.toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) + " WIB";

/** `6281234567890` → `0812-3456-7890` (how Indonesians read a number); anything else as stored. */
export const phone = (v: string) => {
  const m = /^62(8\d{2})(\d{3,4})(\d{3,5})$/.exec(v);
  return m ? `0${m[1]}-${m[2]}-${m[3]}` : v;
};

/** Two-letter store mark ("Batik Nusantara" → "BN"). */
export const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "T";
