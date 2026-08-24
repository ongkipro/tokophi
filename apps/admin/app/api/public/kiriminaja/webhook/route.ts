import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { verifyKaHint } from "@/lib/ka-tracking";
import { readPublicBody } from "@/lib/public-guard";

// KiriminAja webhook receiver (KA-UAT, 2026-08-24) — the push half of tracking; cron/tracking's
// poller remains the NET (this endpoint down = nothing lost, the next tick catches up).
//
// ── THE RULE: the body is a HINT, never a fact ───────────────────────────────────────────────────
// KA's webhook has no signature and no HMAC; its only credential is `Authorization: Bearer
// {api_key}` — OUR key, echoed back (their docs). A delivery event here would collect COD cash, so
// nothing in the payload is believed: we extract the order ids it names and run a VERIFIED PULL of
// the tracking endpoint for each (`verifyKaHint` → kaTrack → syncOrderFromKa). A forged request can
// therefore only make us re-check truth we would have polled anyway — worst case it spends one
// tracking call, which is why the id list is capped.
//
// Registered at KA via their set-callback endpoint (one URL per account):
//   https://app.tokophi.com/api/public/kiriminaja/webhook
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HINTS = 50; // one webhook batch; a bigger flood is a bug or an attack either way

// Timing-safe bearer check against KIRIMINAJA_API_KEY. FAIL CLOSED: no key configured means NO
// (a misconfigured deploy must refuse, not wave every caller through) — same stance as cron-auth.
function authorized(req: NextRequest): boolean {
  const key = (process.env.KIRIMINAJA_API_KEY ?? "").trim();
  if (!key) return false;
  const h = req.headers.get("authorization") ?? "";
  const presented = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    // 401, not silent 200: KA logs delivery failures, and a key mismatch should surface on THEIR
    // dashboard and ours rather than reading as "delivered" while every event is dropped.
    console.warn("[ka-webhook] unauthorized webhook call rejected");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Server-to-server (KiriminAja → us): no browser, so no CORS headers are needed — the empty map
  // satisfies readPublicBody's signature without publishing an Access-Control-Allow-Origin.
  const raw = await readPublicBody(req, {});
  if (raw.res) return raw.res;
  let payload: { method?: unknown; data?: unknown };
  try {
    payload = JSON.parse(raw.text) as { method?: unknown; data?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }
  const method = typeof payload.method === "string" ? payload.method : "unknown";
  const rows = Array.isArray(payload.data) ? payload.data.slice(0, MAX_HINTS) : [];

  let known = 0;
  let changed = 0;
  for (const row of rows) {
    const id = row && typeof row === "object" ? (row as { order_id?: unknown }).order_id : null;
    if (typeof id !== "string" || !id || id.length > 40) continue;
    try {
      const r = await verifyKaHint(id);
      if (r.known) known++;
      if (r.changed.length) changed++;
    } catch (err) {
      // One bad order must not cost the batch — same rule as the poller's loop.
      console.error("[ka-webhook] hint verification failed", id, err);
    }
  }
  // Evidence line, no PII: method + counts only (the poller's logRaw owns payload-shape evidence).
  console.log(`[ka-webhook] method=${method} hints=${rows.length} known=${known} changed=${changed}`);
  // 200 even when nothing matched: a foreign/stale id is not OUR delivery failure, and a non-2xx
  // would put KA into a retry storm over ids that will never resolve.
  return NextResponse.json({ ok: true, known, changed });
}
