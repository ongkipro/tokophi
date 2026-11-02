/**
 * Content-Security-Policy, REPORT-ONLY (2026-11 review item 5).
 *
 * Nothing here blocks anything: the header is `Content-Security-Policy-Report-Only`, so a wrong
 * source list costs a log line, never a broken checkout. The point is to MEASURE for a week what each
 * surface really loads, then promote the policy to enforcing with the list the data supports.
 *
 * Deliberately still carries `'unsafe-inline'` for scripts and styles — Next hydration and the
 * storefront's inline pixel stubs need it today. Removing it needs per-request nonces (Next
 * middleware / Astro) and is the NEXT step, not this one. What this policy already catches: a
 * third-party script/connection nobody listed, `<object>`/`<embed>`, a `<base>` or form-action
 * hijack, and any framing (admin). Pure — no Node, no framework — so both Next and Astro import it.
 */

const SELF = "'self'";

/** Seller + Super Admin: everything is first-party; only product photos may come from anywhere https. */
export const ADMIN_CSP_REPORT_ONLY = [
  `default-src ${SELF}`,
  `base-uri ${SELF}`,
  "object-src 'none'",
  `form-action ${SELF}`,
  "frame-ancestors 'none'",
  `script-src ${SELF} 'unsafe-inline'`,
  `style-src ${SELF} 'unsafe-inline'`,
  `img-src ${SELF} data: blob: https:`,
  `font-src ${SELF} data:`,
  `connect-src ${SELF}`,
  `media-src ${SELF} blob: https:`,
  `worker-src ${SELF} blob:`,
  "report-uri /api/csp-report",
].join("; ");

// Marketing pixels are the dominant third-party cost and are deferred to first interaction
// (storefront-perf rules). They are the only scripts a shopper page may load besides its own.
const PIXEL_SCRIPTS = [
  "https://connect.facebook.net",
  "https://analytics.tiktok.com",
  "https://www.googletagmanager.com",
  "https://www.google-analytics.com",
  "https://googleads.g.doubleclick.net",
  "https://www.googleadservices.com",
];
const PIXEL_CONNECT = [
  "https://www.facebook.com",
  "https://connect.facebook.net",
  "https://analytics.tiktok.com",
  // Observed 2026-11-02 in Chromium (first-party report arrived at /api/csp-report): the TikTok pixel
  // enriches via analytics-ipv6.tiktokw.us. The list is a STARTING POINT — a week of real reports
  // decides the rest before this is ever promoted to enforcing.
  "https://*.tiktokw.us",
  "https://www.googletagmanager.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://stats.g.doubleclick.net",
  "https://www.googleadservices.com",
];

/** Storefront: first-party + the three ad platforms. `frame-ancestors` is deliberately absent (Store Builder preview). */
export const STOREFRONT_CSP_REPORT_ONLY = [
  `default-src ${SELF}`,
  `base-uri ${SELF}`,
  "object-src 'none'",
  `form-action ${SELF}`,
  `script-src ${SELF} 'unsafe-inline' ${PIXEL_SCRIPTS.join(" ")}`,
  `style-src ${SELF} 'unsafe-inline'`,
  `img-src ${SELF} data: blob: https:`,
  `font-src ${SELF} data:`,
  `connect-src ${SELF} ${PIXEL_CONNECT.join(" ")}`,
  `media-src ${SELF} https:`,
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.facebook.com https://td.doubleclick.net",
  "report-uri /api/csp-report",
].join("; ");

export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/** A browser report is attacker-writable input: keep a few short, query-free fields and nothing else. */
export const MAX_REPORT_BYTES = 8 * 1024;

// Control characters out: a report field is attacker-writable and ends up in a log line, where a
// newline or an ANSI escape would forge a `[csp-report] …` line of its own.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const clip = (v: unknown, n = 120): string => (typeof v === "string" ? v.replace(CONTROL, " ").slice(0, n) : "");

/**
 * The request body as text, never more than `MAX_REPORT_BYTES + 1` bytes held in memory. A chunked
 * POST has no Content-Length, so checking the header alone lets a client stream gigabytes into
 * `request.text()`; this stops reading at the cap and cancels the stream.
 */
export async function readReportBody(req: Request): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total <= MAX_REPORT_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total > MAX_REPORT_BYTES) await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(total, MAX_REPORT_BYTES + 1));
  let at = 0;
  for (const c of chunks) {
    const room = all.length - at;
    if (room <= 0) break;
    all.set(c.subarray(0, room), at);
    at += Math.min(c.byteLength, room);
  }
  return new TextDecoder().decode(all);
}

/** `https://a.example/x?token=1#f` → `https://a.example/x` (query and fragment can carry secrets/PII). */
function stripUrl(v: unknown): string {
  const s = clip(v, 300);
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return s.slice(0, 40); // keywords: inline, eval, self, data…
  try {
    const u = new URL(s);
    return `${u.origin === "null" ? u.protocol : u.origin}${u.pathname}`.slice(0, 160);
  } catch {
    return "";
  }
}

/**
 * One log line for a `report-uri` body (`{"csp-report": {…}}`) or a Reporting-API array
 * (`[{type:"csp-violation", body:{…}}]`). Returns `null` for anything that is not a CSP report.
 */
export function summariseCspReport(raw: string): string | null {
  if (!raw || raw.length > MAX_REPORT_BYTES) return null;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  const first = Array.isArray(j) ? (j[0] as { body?: unknown } | undefined)?.body : (j as { "csp-report"?: unknown })?.["csp-report"];
  if (!first || typeof first !== "object") return null;
  const r = first as Record<string, unknown>;
  const directive = clip(r["effective-directive"] ?? r["effectiveDirective"] ?? r["violated-directive"] ?? r["violatedDirective"], 60);
  if (!directive) return null;
  const blocked = stripUrl(r["blocked-uri"] ?? r["blockedURL"] ?? r["blockedUri"]);
  const doc = stripUrl(r["document-uri"] ?? r["documentURL"] ?? r["documentUri"]);
  const src = stripUrl(r["source-file"] ?? r["sourceFile"]);
  const line = Number(r["line-number"] ?? r["lineNumber"]);
  return `directive=${directive} blocked=${blocked || "-"} doc=${doc || "-"}${src ? ` src=${src}${Number.isFinite(line) ? `:${line}` : ""}` : ""}`;
}
