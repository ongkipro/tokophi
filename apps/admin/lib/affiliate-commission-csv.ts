// F-A11 (specs/AFFILIATE_SPEC.md): the commission export's PURE half — date-range parsing and the CSV text.
// The read lives in `exportAffiliateCommissionsCsv` (lib/actions/affiliates.ts, `affiliates:write`,
// inside `withTenant`); this module only turns rows into a file, so it can be tested without a database.
import { COMMISSION_STATE, type CommissionState } from "@/lib/commission-state";

/** Longest range one export may cover — a bookkeeping year plus a day (leap years). */
export const EXPORT_MAX_DAYS = 366;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real calendar date (2026-02-30 is refused, not rolled over to March). */
function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export type ExportRange = { ok: true; from: string; to: string } | { ok: false; error: string };

/** Both ends INCLUSIVE, merchant (WIB) calendar dates. Refused, never guessed. */
export function parseExportRange(from: unknown, to: unknown): ExportRange {
  if (!isDate(from) || !isDate(to)) return { ok: false, error: "Pilih tanggal mulai dan tanggal akhir." };
  if (from > to) return { ok: false, error: "Tanggal mulai harus sebelum tanggal akhir." };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > EXPORT_MAX_DAYS) return { ok: false, error: `Rentang maksimal ${EXPORT_MAX_DAYS} hari.` };
  return { ok: true, from, to };
}

/**
 * One CSV cell. CSV-INJECTION SAFE: a cell a spreadsheet would read as a formula (`=`, `+`, `-`, `@`, or a
 * leading tab / carriage return) gets a leading apostrophe, the OWASP recommendation. Affiliate names,
 * codes and the seller's payment note are typed by people outside this store, so they are untrusted.
 * Numbers are written as numbers (a negative amount cannot occur: CHECK `commission_idr >= 0`).
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type CommissionExportRow = {
  orderNumber: string;
  placedAt: Date;
  affiliateName: string;
  affiliateCode: string;
  source: string;
  baseIdr: number;
  rateNote: string | null;
  commissionIdr: number;
  state: CommissionState;
  paidAt: Date | null;
  paidNote: string | null;
};

const HEADER = [
  "Nomor pesanan",
  "Tanggal pesanan (WIB)",
  "Nama affiliate",
  "Kode affiliate",
  "Sumber",
  "Nilai produk (Rp)",
  "Tarif",
  "Komisi (Rp)",
  "Status",
  "Dibayar pada (WIB)",
  "Catatan pembayaran",
];

/** `2026-11-14 09:05` in WIB — sortable, and what the merchant's own calendar says. */
const wib = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d)
    : "";

/** The whole file: UTF-8 BOM (Excel otherwise reads it as ANSI), CRLF line ends (RFC 4180). */
export function commissionCsv(rows: CommissionExportRow[]): string {
  const lines = [HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.orderNumber,
        wib(r.placedAt),
        r.affiliateName,
        r.affiliateCode,
        r.source === "kode" ? "Kode diketik" : "Link",
        r.baseIdr,
        r.rateNote,
        r.commissionIdr,
        COMMISSION_STATE[r.state].label,
        wib(r.paidAt),
        r.paidNote,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
