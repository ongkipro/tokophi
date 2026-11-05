// Receiver for the Content-Security-Policy-Report-Only header set in src/middleware.ts.
// Same-origin by construction (the policy says `report-uri /api/csp-report`), so no CORS and no
// tenant lookup: the report says which page it came from. Writes nothing to the database — one
// query-stripped log line per report (summariseCspReport), after a per-IP floor so a hostile page
// cannot turn this into a log-flood. Always 204: a shopper's browser must never see an error from it.
import type { APIRoute } from "astro";
import { MAX_REPORT_BYTES, readReportBody, summariseCspReport } from "@tokophi/lib/csp";

export const prerender = false;

const LIMIT = 60; // reports per IP per minute — a page with one bad pixel sends a handful
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; reset: number }>();

function allow(key: string): boolean {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now > e.reset) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    if (hits.size > 10_000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return true;
  }
  e.count++;
  return e.count <= LIMIT;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = request.headers.get("cf-connecting-ip") ?? clientAddress ?? "unknown";
  if (!allow(ip)) return new Response(null, { status: 204 });
  const len = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_REPORT_BYTES) return new Response(null, { status: 204 });
  const line = summariseCspReport(await readReportBody(request));
  if (line) console.warn(`[csp-report] ${line}`);
  return new Response(null, { status: 204 });
};
