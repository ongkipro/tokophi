// Indonesian-market formatting helpers.
import { normalizePhone } from "./validate";

export const IDR = (n: number, opts: { compact?: boolean } = {}) => {
  if (opts.compact) {
    if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")} M`;
    if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} jt`;
    if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)} rb`;
  }
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
};

export const num = (n: number) => new Intl.NumberFormat("id-ID").format(n);

// DELTA formatter: always carries its own sign, so a fall reads as a fall even without the arrow.
// "+16,9%" / "−6,4%" / "0,0%" — id-ID decimal comma, typographic minus (U+2212, matches the
// money tiles). It is NOT a rate formatter: for a plain share/rate (e.g. tingkat retur) format
// locally instead of borrowing the "+".
// Negative input used to come out as "-6.4%" (ASCII hyphen, dot) and callers that passed
// Math.abs(delta) got a bare "+6,4%" for a DECLINE — hence the explicit sign here.
export const pct = (n: number, digits = 1) => {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits).replace(".", ",")}%`;
};

export const timeAgo = (minutes: number) => {
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${Math.floor(minutes)} mnt lalu`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
};

// ⚠️ `timeZone` is LOAD-BEARING on both of these — do not drop it to "simplify".
// Without it `Intl` uses the RUNTIME's zone, which is not the same runtime twice: the containers
// set no TZ so Node renders UTC, while the merchant's browser renders Asia/Jakarta (UTC+7). These
// run inside "use client" components, so the string is produced ONCE on the server and AGAIN in the
// browser — and the two disagreed by 7 hours, which is React error #418 ("text content does not
// match server-rendered HTML") on /produk in production. It is not merely a hydration warning:
// the shifted rows also crossed midnight, so a product added 21 Jun 17.49 WIB was filed under
// 22 Jun for anyone reading the SSR HTML. The seller's day ends at Jakarta midnight (the same
// boundary lib/data/ledger.ts + lib/data/finance.ts already anchor to), so that is the zone
// these must format in — on the server and in the browser alike.
const TZ = "Asia/Jakarta";

// Date + time, id-ID WIB, e.g. "1 Jul 2026, 14.30".
export function dateTimeShort(ts: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(ts));
}

// Date only, id-ID WIB, e.g. "1 Jul 2026".
export function dateShort(ts: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric", timeZone: TZ,
  }).format(new Date(ts));
}

// Build a wa.me deep link from an Indonesian phone + optional prefilled message.
//
// wa.me needs the COUNTRY CODE: `wa.me/08124612804` does not open a chat — it is not a phone number
// as far as WhatsApp is concerned, it is a local dialling string. Everything is stored canonical now
// (`62…`, migration 0048 + normalizePhone on write), but a legacy/imported `08…` row must still
// produce a link that works, so normalise here as well and only fall back to raw digits when the
// number cannot be understood at all.
export function waLink(phone: string, message = ""): string {
  const p = normalizePhone(phone) ?? String(phone).replace(/\D/g, "");
  return `https://wa.me/${p}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

// Fill {{placeholder}} tokens in a WhatsApp template with values (unknown tokens left as-is).
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}
