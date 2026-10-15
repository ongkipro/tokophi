import type { CommissionState } from "../data/affiliate";

export const STATUS_LABEL = {
  menunggu: { text: "Menunggu persetujuan", tone: "warn" },
  aktif: { text: "Aktif", tone: "ok" },
  ditolak: { text: "Ditolak", tone: "bad" },
  nonaktif: { text: "Nonaktif", tone: "" },
} as const;

export const STATE_LABEL: Record<CommissionState, { text: string; tone: string }> = {
  belum_selesai: { text: "Menunggu pesanan selesai", tone: "" },
  ditahan: { text: "Ditahan", tone: "warn" },
  siap: { text: "Siap dibayar", tone: "ok" },
  dibayar: { text: "Sudah dibayar", tone: "ok" },
  batal: { text: "Batal", tone: "bad" },
};

export const dateId = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
