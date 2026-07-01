// Indonesian-market formatting helpers.

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

export const pct = (n: number, digits = 1) =>
  `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;

export const timeAgo = (minutes: number) => {
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${Math.floor(minutes)} mnt lalu`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
};

// Date + time, id-ID, e.g. "1 Jul 2026, 14.30".
export function dateTimeShort(ts: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts));
}

// Date only, id-ID, e.g. "1 Jul 2026".
export function dateShort(ts: number): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(ts));
}

// Build a wa.me deep link from an Indonesian phone (digits only) + optional prefilled message.
export function waLink(phone: string, message = ""): string {
  const p = String(phone).replace(/\D/g, "");
  return `https://wa.me/${p}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

// Fill {{placeholder}} tokens in a WhatsApp template with values (unknown tokens left as-is).
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}
