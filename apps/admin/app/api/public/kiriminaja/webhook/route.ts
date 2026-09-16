import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { verifyKaHint } from "@/lib/ka-tracking";
import { clientIp, readPublicBody } from "@/lib/public-guard";
import { activeKaKey } from "@tokophi/lib/provider-config";

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

// Timing-safe bearer check against the platform's ACTIVE KiriminAja key — Task 8.33: the Super
// Admin's stored key for the live environment, or `KIRIMINAJA_API_KEY` as the fallback, from the
// same seam every booking uses, so a rotation done on the card is honoured here in the same minute.
// FAIL CLOSED: no key configured means NO (a misconfigured deploy must refuse, not wave every
// caller through) — same stance as cron-auth.
const activeKey = async (): Promise<string> => ((await activeKaKey()) ?? "").trim();

function authorized(req: NextRequest, key: string): boolean {
  if (!key) return false;
  const h = req.headers.get("authorization") ?? "";
  const presented = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── THE OPEN QUESTION: DOES KA SEND A CREDENTIAL AT ALL? ─────────────────────────────────────────
//
// Their OpenAPI 3.1 document (`info.version` 6.2.0) declares the incoming webhook
// `expressShipmentEvent` with **`security: null`** — i.e. the spec documents NO authentication on
// the callback, while their prose docs say the callback carries `Authorization: Bearer {api_key}`.
// The two disagree, and only a REAL delivery event can settle it. We keep the bearer requirement
// (this endpoint mutates orders — `awb` and status — so an unsigned write is not an option), which
// means that if the spec is right, every genuine shipment event is refused and the log is the only
// place the answer can appear.
//
// So the rejection line below describes the SHAPE of what the caller presented, never its content:
// whether an `Authorization` header arrived, its scheme class, the credential's LENGTH, whether that
// length matches the configured key, the caller IP, and the NAMES of any vendor-ish headers. That is
// enough to tell the three cases apart on the first genuine rejection:
//
//   · `auth=absent` from a KiriminAja IP, with `hdrs=` naming something like `x-callback-token`
//     → the spec is right, they authenticate some other way; adapt the gate to THAT header.
//   · `auth=present scheme=bearer lenMatch=no` → they send a bearer, but not this key
//     (wrong account key, or a key of theirs rather than ours) — a configuration fix.
//   · `lenMatch=nokey` → OUR side has no key for the active env — nothing stored on the Super Admin
//     card and no `KIRIMINAJA_API_KEY` in the container; nothing about the vendor.
//   · `auth=absent hdrs=` empty, from a random IP → a probe. Ignore it.
//
// ⚠️ NOTHING HERE MAY BE A VALUE. Not the key, not a header's contents, not a prefix of either — a
// prefix is a free head start on the credential, and this line is written to a log that is read
// casually and copied into tickets. Lengths and names only.
const VENDORISH_NOISE = new Set([
  // Infrastructure headers every request carries; naming them would bury the one that matters.
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-request-id",
  "x-middleware-invoke",
  "x-invoke-path",
  "x-invoke-query",
]);

/**
 * The shape of a rejected caller's credentials — never their content.
 *
 * Deliberately SEPARATE from `authorized()` rather than refactored out of it: this is diagnosis, and
 * a diagnosis that drifts from the gate is a wrong log line, while a gate that drifts to serve a log
 * line is a security bug. The gate above is untouched.
 */
function rejectionShape(req: NextRequest, key: string): string {
  const header = req.headers.get("authorization");

  // The scheme is reported as a CLASS, not as the token the caller typed. A caller that sends the
  // bare credential with no scheme (`Authorization: <secret>`) would otherwise have its first word —
  // the whole secret — echoed into the log by an "just print the scheme" implementation.
  let scheme: "none" | "bearer" | "other" = "none";
  let credential = "";
  if (header !== null) {
    const trimmed = header.trim();
    if (/^Bearer\s/i.test(trimmed)) {
      scheme = "bearer";
      credential = trimmed.replace(/^Bearer\s+/i, "");
    } else {
      scheme = trimmed ? "other" : "none";
      credential = trimmed;
    }
  }

  const lenMatch = !key ? "nokey" : credential.length === key.length ? "yes" : "no";

  // Header NAMES only, so a real KiriminAja call reveals what it actually authenticates with even if
  // we never guessed the name. Sorted for greppability, capped so one caller cannot flood the line.
  const names: string[] = [];
  req.headers.forEach((_value, name) => {
    const n = name.toLowerCase();
    if (n === "authorization" || VENDORISH_NOISE.has(n)) return;
    if (n.startsWith("x-") || n === "signature" || n === "token" || n === "api-key") names.push(n);
  });
  names.sort();
  const shown = names.slice(0, 12);
  if (names.length > shown.length) shown.push(`+${names.length - shown.length}more`);

  return [
    `auth=${header === null ? "absent" : "present"}`,
    `scheme=${scheme}`,
    `credLen=${credential.length}`,
    `lenMatch=${lenMatch}`,
    `ip=${clientIp(req)}`,
    `hdrs=${shown.join(",")}`,
  ].join(" ");
}

export async function POST(req: NextRequest) {
  const key = await activeKey();
  if (!authorized(req, key)) {
    // 401, not silent 200: KA logs delivery failures, and a key mismatch should surface on THEIR
    // dashboard and ours rather than reading as "delivered" while every event is dropped.
    //
    // ONE line, prefix unchanged, original phrase kept verbatim so existing `[ka-webhook]` and
    // "unauthorized webhook call rejected" greps still match.
    console.warn(`[ka-webhook] unauthorized webhook call rejected ${rejectionShape(req, key)}`);
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
    const r0 = row && typeof row === "object" ? (row as { order_id?: unknown; awb?: unknown; sorting_code?: unknown }) : null;
    const id = r0?.order_id;
    if (typeof id !== "string" || !id || id.length > 40) continue;
    try {
      // `processed_packages` is where KiriminAja delivers the sorting code. The row's `awb` and
      // `sorting_code` are passed as an UNTRUSTED hint: verifyKaHint accepts the code only when that
      // awb equals the waybill it verifies for the order (sortingCodeFromHint).
      const r = await verifyKaHint(id, { awb: r0?.awb, sortingCode: r0?.sorting_code });
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
