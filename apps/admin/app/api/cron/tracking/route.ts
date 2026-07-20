import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, asc, isNotNull, inArray, sql } from "drizzle-orm";
import { kaTrack, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { outcomeFromTrackingCode, syncOrderFromKa } from "@/lib/ka-tracking";

// Tracking POLLER (BACKLOG shipping #1/#2) — the pull half. A booking returns `awb: null`; the waybill,
// and every state after it, only exist once a courier accepts the pickup. This cron sweeps the orders
// that are booked but not yet finished, pulls KiriminAja tracking, fills the AWB when it lands, and
// advances the order to match the courier — all through lib/ka-tracking.
//
// ⚠️ THERE IS NO WEBHOOK. This comment used to end "…the same path the webhook uses", and no such path
// exists: `apps/admin/app/api/` has no KiriminAja callback route and nothing ever calls their
// set-callback endpoint. Polling is the ONLY way an AWB reaches us today. KiriminAja does document a
// webhook (`processed_packages` fires exactly when the AWB is created), and it is the right mechanism
// for an asynchronous waybill — but their docs specify NO signature, NO HMAC and NO IP allowlist, and
// in this system a `finished_packages` event collects COD cash and credits the ledger. So if it is
// ever adopted it must be treated as an UNTRUSTED HINT that triggers a verified pull of this same
// tracking endpoint — never as an authority that moves money on an unsigned request body.
//
// Schedule it like cron/billing (external cron → GET with the secret). Idempotent: syncOrderFromKa only
// moves an order FORWARD, so re-running is a no-op once the courier state is caught up.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap per run — each item is a live KiriminAja call. ⚠️ This is a CAP, not rate limiting: the loop below
// fires up to 100 requests back-to-back with no pacing, no concurrency limit and no 429 handling. The
// comment here used to claim it protected against rate-limiting; it does not. It bounds one sweep, which
// is why the ORDER BY beneath it matters — with a cap and no fairness, the excess is starved, not queued.
const BATCH = 100;

// ─────────────────────────────────────────────────────────────────────────────
// RAW TRACKING EVIDENCE — one greppable line per poll (`docker logs cron-tracking | grep ka-raw`).
//
// Two BACKLOG blockers cannot be settled from code or docs, only from a real payload, and until now
// every payload that could have answered them was discarded the instant it was mapped:
//
//   (i)  ARE WE TRACKING THE RIGHT ID? Booking registers OUR order number as `TOKOPHI-<ref>`, while
//        this poller queries with KiriminAja's `kj_order_id` under the key `order_id` — and their doc
//        describes that field as `order_id string(max:20)`. If it is the wrong id the API answers
//        "not found", which today is indistinguishable from "no tracking yet" because BOTH hit the
//        silent `continue` below. That is why `ok:false` is logged too, with `err` — a not-found
//        message IS the evidence.
//   (ii) DOES 200 MEAN DELIVERED? Their webhook doc says 200 = picked up and 300 = delivered; their
//        tracking doc says 200 = Delivered. We map 200 → delivered, which on a COD parcel collects
//        cash and credits the ledger. If 200 really means "picked up", we settle money on a parcel
//        still in transit. Logging `status` next to the response's own text/keys is what will let a
//        human read one real booking and know which doc is lying.
//
// ⚠️ NOT A PII DUMP. This is a shipping-status log: it records the status, the waybill, the response's
// own message, and the NAMES of the other keys — never their values. Tracking responses carry the
// recipient's name, phone and full address; a log line is copied into tickets, chats and screenshots,
// and none of those are places a buyer's address belongs. If you add a field here, add a value you
// have looked at — key names are safe precisely because they are not data.
// ─────────────────────────────────────────────────────────────────────────────
function logRaw(fields: Record<string, unknown>) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  console.log("[cron/tracking][ka-raw]", parts.join(" "));
}

/** Truncated so a courier essay cannot flood the log; text messages are safe, addresses are not. */
const short = (v: unknown, n = 120) => (typeof v === "string" ? v.slice(0, n) : v ?? null);

export async function GET(req: NextRequest) {
  // FAIL CLOSED in production, exactly like cron/billing: an unset secret must mean NO, not "no gate".
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron/tracking] CRON_SECRET unset in production — REJECTING.");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!kiriminajaConfigured()) {
    return NextResponse.json({ ok: false, error: "KiriminAja belum dikonfigurasi." }, { status: 200 });
  }

  // Booked, in-flight orders: they have a KiriminAja booking (ka_order_id) and haven't reached a
  // terminal state. `selesai`/`retur`/`batal` are done — nothing left to poll.
  // ORDER BY is load-bearing, not cosmetic. This was a bare `.limit(BATCH)` with no ordering: Postgres
  // may return the same arbitrary 100 rows every tick, so past ~100 in-flight orders some could go
  // unpolled FOREVER — and the ones starved were as likely to be the AWB-less ones (the only ones with
  // work outstanding) as any other. Orders still waiting for a waybill go first, then the oldest.
  const orders = await db
    .select({ number: schema.orders.number, kaOrderId: schema.orders.kaOrderId, awb: schema.orders.awb })
    .from(schema.orders)
    .where(and(isNotNull(schema.orders.kaOrderId), inArray(schema.orders.status, ["diproses", "dikirim"])))
    .orderBy(sql`${schema.orders.awb} is not null`, asc(schema.orders.placedAt))
    .limit(BATCH);

  let advanced = 0;
  let awbFilled = 0;
  let problems = 0;
  let problemsCleared = 0;
  const errors: string[] = [];
  for (const o of orders) {
    const ref = o.kaOrderId ?? o.awb;
    if (!ref) continue;
    // The pull is INSIDE the try. It used to sit outside it, and `ka()` did a bare `res.json()` with no
    // status check — so a single HTML 502 from KiriminAja's gateway threw a JSON parse error that
    // escaped GET entirely, returned 500, and left every remaining order in the batch unpolled. One bad
    // reply must cost one order, never the sweep.
    let r: Awaited<ReturnType<typeof kaTrack>>;
    try {
      r = await kaTrack(ref);
    } catch (err) {
      console.error("[cron/tracking] tracking pull failed", o.number, err);
      errors.push(o.number);
      continue;
    }
    if (!r.ok) {
      // Blocker (i) lives HERE. "No tracking yet" and "you asked with an id we do not recognise" are
      // the same silent `continue`, and only KiriminAja's own error text tells them apart. Capture it.
      logRaw({ order: o.number, ref, sentAs: o.kaOrderId ? "ka_order_id" : "awb", ok: false, err: short(r.error) });
      continue; // no tracking yet (courier hasn't processed it) — try again next run
    }
    // `text`/`status_text` are read ONLY for the evidence log — nothing maps off them. Both spellings
    // have been seen in KiriminAja responses and neither is guaranteed; `r.data` is `unknown`, so
    // widening the cast here costs nothing and keeps the log free of extra assertions.
    const data = (r.data ?? {}) as {
      awb?: string; waybill?: string; status?: string | number; text?: string; status_text?: string;
    };
    // A waybill is only real if it isn't our own booking ref echoed back.
    const realAwb = [data.awb, data.waybill].find((x) => !!x && x !== ref) ?? null;
    // Pass the raw status (number OR text); an unmapped status is `null`, which fills the AWB and
    // changes nothing. It is NOT forced to "shipped" — doing that pinned a delivered parcel at
    // `dikirim` forever, so COD was never collected and the merchant never credited.
    const outcome = outcomeFromTrackingCode(data.status);

    // Log BEFORE the `continue` below and BEFORE any mapping is acted on. The unmapped case
    // (`outcome=null`) is the single most valuable line in this file — it is a status KiriminAja
    // really sends that we really do not understand — and it was the one case that produced no
    // record at all. `keys` names the other fields of the payload without printing their values, so
    // the response SHAPE (blocker i) is discoverable without logging a buyer's address.
    logRaw({
      order: o.number,
      ref,
      sentAs: o.kaOrderId ? "ka_order_id" : "awb",
      ok: true,
      status: data.status ?? null,
      statusType: typeof data.status,
      awb: short(data.awb),
      waybill: short(data.waybill),
      awbIsRef: !!(data.awb && data.awb === ref) || !!(data.waybill && data.waybill === ref),
      outcome: outcome ?? "unmapped",
      // KiriminAja's own wording for the status. `kaTrack` only surfaces the envelope's `text` on
      // failure, so on success the human-readable string — the thing that will actually settle
      // "200 = delivered or picked up?" — can only come from inside `data`. Both spellings observed.
      text: short(data.text ?? data.status_text),
      keys: Object.keys(data).sort().join(","),
    });

    if (!realAwb && !outcome) continue;
    // A stuck/problem parcel is not a state change but it IS something a merchant must act on. It now
    // reaches the seller as a real flag on the order (`orders.problem_at`/`problem_note`, migration
    // 0062) — shown on the order detail and in the Pesanan list — instead of dying in this log.
    // The note is merchant-facing Indonesian; the raw code stays in the log line above, not in the DB.
    let problemNote: string | null = null;
    if (outcome === "problem") {
      problems++;
      problemNote = `Kurir melaporkan kendala pengiriman (kode ${String(data.status ?? "-")}). Hubungi kurir atau pembeli untuk memastikan paket.`;
      console.warn("[cron/tracking] problem parcel", o.number, "status", data.status);
    }
    try {
      const s = await syncOrderFromKa(o.number, outcome, realAwb, problemNote);
      if (s.changed.some((c) => c.startsWith("awb"))) awbFilled++;
      if (s.changed.some((c) => c.startsWith("status"))) advanced++;
      // A parcel that started moving again. Worth its own number: it is how you tell "3 problems"
      // meaning "3 parcels are stuck right now" from "3 parcels hiccuped and recovered".
      if (s.changed.includes("problem:cleared")) problemsCleared++;
    } catch (err) {
      console.error("[cron/tracking] sync failed", o.number, err);
      errors.push(o.number);
    }
  }

  return NextResponse.json({
    ok: true, scanned: orders.length, advanced, awbFilled, problems, problemsCleared, errors: errors.length,
  });
}
