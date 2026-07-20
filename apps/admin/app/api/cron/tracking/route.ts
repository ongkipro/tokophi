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
    if (!r.ok) continue; // no tracking yet (courier hasn't processed it) — try again next run
    const data = (r.data ?? {}) as { awb?: string; waybill?: string; status?: string | number };
    // A waybill is only real if it isn't our own booking ref echoed back.
    const realAwb = [data.awb, data.waybill].find((x) => !!x && x !== ref) ?? null;
    // Pass the raw status (number OR text); an unmapped status is `null`, which fills the AWB and
    // changes nothing. It is NOT forced to "shipped" — doing that pinned a delivered parcel at
    // `dikirim` forever, so COD was never collected and the merchant never credited.
    const outcome = outcomeFromTrackingCode(data.status);
    if (!realAwb && !outcome) continue;
    // A stuck/problem parcel is not a state change but it IS something a merchant must act on — the
    // poller can't stay silent about it. Surface it in the run summary + logs (a merchant-facing flag
    // needs an orders column — tracked as follow-up).
    if (outcome === "problem") {
      problems++;
      console.warn("[cron/tracking] problem parcel", o.number, "status", data.status);
    }
    try {
      const s = await syncOrderFromKa(o.number, outcome, realAwb);
      if (s.changed.some((c) => c.startsWith("awb"))) awbFilled++;
      if (s.changed.some((c) => c.startsWith("status"))) advanced++;
    } catch (err) {
      console.error("[cron/tracking] sync failed", o.number, err);
      errors.push(o.number);
    }
  }

  return NextResponse.json({ ok: true, scanned: orders.length, advanced, awbFilled, problems, errors: errors.length });
}
