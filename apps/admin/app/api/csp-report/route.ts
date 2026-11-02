import { MAX_REPORT_BYTES, readReportBody, summariseCspReport } from "@tokophi/lib/csp";

// Receiver for the Content-Security-Policy-Report-Only header set in next.config.ts.
//
// Behind the session gate ON PURPOSE: a same-origin `report-uri` request carries the cookie, and a
// logged-in operator is the only person who can trigger a violation on these surfaces. That keeps this
// out of the unauthenticated write surface (only `api/public/*` is allowed to be one). A violation on
// /login itself gets a 401, is lost, AND shows as one console error per page load. ⚠️ /login is NOT
// free of third-party content: Cloudflare injects its Web Analytics beacon into every proxied page
// (measured 2026-11-02, the first production violation) — which is why the policies list it. If a
// new violation appears on /login, fix the source list; do not open this route to anonymous callers.
//
// Writes nothing to the database. The report is attacker-writable input, so only a fixed set of short,
// query-stripped fields reaches the log (summariseCspReport) and the body is capped before parsing.
export async function POST(req: Request): Promise<Response> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
  const line = summariseCspReport(await readReportBody(req));
  if (line) console.warn(`[csp-report] ${line}`);
  return new Response(null, { status: 204 });
}
