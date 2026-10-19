// The store's own complaint-resolution period (store_settings.complaint_resolution_days, migration 0121).
// PP 80/2019 Pasal 27(2)(e), read 2026-10-19: a business's complaint service must cover, at least, "jangka waktu
// penyelesaian pengaduan". NULL = the store has declared none, and the buyer is shown nothing — never a number we
// made up. The range is ours (the regulation sets no figure): a whole number of working days, 1–60.
import { parseWorkingDays, type WorkingDaysParse } from "./working-days";

export const COMPLAINT_DAYS_MIN = 1;
export const COMPLAINT_DAYS_MAX = 60;

const INVALID = `Isi angka bulat ${COMPLAINT_DAYS_MIN}–${COMPLAINT_DAYS_MAX} (hari kerja), atau kosongkan bila toko belum menetapkan jangka waktu penyelesaian.`;

export const parseComplaintDays = (v: unknown): WorkingDaysParse => parseWorkingDays(v, COMPLAINT_DAYS_MIN, COMPLAINT_DAYS_MAX, INVALID);

/** What a buyer reads. It states the store's own figure and nothing about what the law requires. */
export const complaintLine = (days: number | null | undefined): string | null =>
  days && days > 0 ? `Jangka waktu penyelesaian komplain yang ditetapkan toko: ${days} hari kerja.` : null;
