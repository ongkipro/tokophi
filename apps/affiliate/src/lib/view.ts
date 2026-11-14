import type { CommissionState, MyStore } from "../data/affiliate";

export const STATUS_LABEL = {
  menunggu: { text: "Menunggu persetujuan", tone: "warning" },
  aktif: { text: "Aktif", tone: "done" },
  ditolak: { text: "Ditolak", tone: "danger" },
  nonaktif: { text: "Nonaktif", tone: "muted" },
} as const;

/** What each programme status means for the affiliate, in one sentence — and what to do next. */
export const STATUS_NOTE: Record<MyStore["status"], string> = {
  aktif: "",
  menunggu: "Seller sedang meninjau pendaftaran Anda. Kode dan link Anda aktif begitu disetujui.",
  ditolak: "Pendaftaran tidak disetujui seller. Ada pertanyaan? Hubungi tokonya langsung.",
  nonaktif: "Seller menonaktifkan kode ini. Pesanan baru tidak menghasilkan komisi; komisi yang sudah tercatat tetap tampil.",
};

/** Programme list order: what can earn money now first, closed ones last; name order within a group. */
const STATUS_ORDER: Record<MyStore["status"], number> = { aktif: 0, menunggu: 1, nonaktif: 2, ditolak: 3 };
export const byStatus = <T extends { status: MyStore["status"] }>(a: T, b: T) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status];

/** The plain-language meaning of each commission state (Komisi filter, Ringkasan tiles). */
export const STATE_MEANING: Record<CommissionState, string> = {
  belum_selesai: "Pesanan masih diproses atau dikirim. Komisi dihitung, tapi masa tahan belum mulai.",
  ditahan: "Pesanan sudah selesai dan sedang dalam masa tahan untuk retur.",
  siap: "Masa tahan sudah lewat. Tinggal ditransfer oleh toko ke rekening Anda.",
  dibayar: "Toko sudah mentransfer komisi ini dan menandainya dibayar.",
  batal: "Pesanan dibatalkan atau diretur, jadi tidak ada komisi.",
};

/** The public TokoΦ contact (same default as apps/landing `IDENTITY.email`). */
export const SUPPORT_EMAIL = "hello@tokophi.com";

/** `https://wa.me/?text=…` — WhatsApp's own share link: the affiliate picks the chat; no API, no number. */
export function waShareUrl(storeName: string, link: string): string {
  const text = `Lihat koleksi ${storeName} di sini:\n${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** "Rina Wulandari" → "Rina" (the greeting). */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export const STATE_LABEL: Record<CommissionState, { text: string; tone: string }> = {
  belum_selesai: { text: "Pesanan belum selesai", tone: "muted" },
  ditahan: { text: "Ditahan", tone: "warning" },
  siap: { text: "Siap dibayar", tone: "done" },
  dibayar: { text: "Sudah dibayar", tone: "info" },
  batal: { text: "Batal", tone: "danger" },
};

export const dateId = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

/** The badge text with the one date that matters for that state: until when it is held, or when it was paid. */
export function stateText(c: { state: CommissionState; eligibleAt: Date | null; paidAt: Date | null }): string {
  if (c.state === "ditahan" && c.eligibleAt) return `Ditahan s.d. ${dateId(c.eligibleAt)}`;
  if (c.state === "dibayar" && c.paidAt) return `Dibayar ${dateId(c.paidAt)}`;
  return STATE_LABEL[c.state].text;
}

/** Store initials for the avatar. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** 1000 bps → "10%", 750 → "7,5%" (id-ID decimal comma). */
export const ratePct = (bps: number) => `${(bps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
