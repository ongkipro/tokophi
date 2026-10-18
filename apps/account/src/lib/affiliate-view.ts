import type { CommissionState, MyStore } from "../data/affiliate";

// Badge classes are the prototype's (`.badge.<tone>` in prototype.css; `danger` in affiliate.css).
export const STATUS_LABEL = {
  menunggu: { text: "Menunggu persetujuan", tone: "warning" },
  aktif: { text: "Aktif", tone: "done" },
  ditolak: { text: "Ditolak", tone: "danger" },
  nonaktif: { text: "Nonaktif", tone: "guest" },
} as const;

export const STATE_LABEL: Record<CommissionState, { text: string; tone: string }> = {
  belum_selesai: { text: "Pesanan belum selesai", tone: "guest" },
  ditahan: { text: "Ditahan", tone: "warning" },
  siap: { text: "Siap dibayar", tone: "done" },
  dibayar: { text: "Sudah dibayar", tone: "indigo" },
  batal: { text: "Batal", tone: "danger" },
};

export const dateId = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

/** The badge text with the one date that matters for that state: until when it is held, or when it was paid. */
export function stateText(c: { state: CommissionState; eligibleAt: Date | null; paidAt: Date | null }): string {
  if (c.state === "ditahan" && c.eligibleAt) return `Ditahan s.d. ${dateId(c.eligibleAt)}`;
  if (c.state === "dibayar" && c.paidAt) return `Dibayar ${dateId(c.paidAt)}`;
  return STATE_LABEL[c.state].text;
}

/** The H+N hold explained once: the stores' own number when they agree, the rule in words when not. */
export function holdLine(stores: Pick<MyStore, "holdDays">[]): string {
  const days = [...new Set(stores.map((s) => s.holdDays))];
  const when =
    days.length === 1
      ? `${days[0]} hari setelah pesanan selesai (H+${days[0]}, masa tahan untuk retur)`
      : "setelah pesanan selesai dan lewat masa tahan toko";
  return `Komisi jadi siap dibayar ${when}. Pembayarannya langsung dari masing-masing toko.`;
}

/** Store initials for the prototype's `.store-mark` avatar. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** 1000 bps → "10%", 750 → "7,5%" (id-ID decimal comma). */
export const ratePct = (bps: number) => `${(bps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
