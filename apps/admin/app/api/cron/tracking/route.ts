import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, isNotNull, inArray } from "drizzle-orm";
import { kaTrack, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { outcomeFromTrackingCode, syncOrderFromKa } from "@/lib/ka-tracking";

// Tracking POLLER (BACKLOG shipping #1/#2) — the pull half. A booking returns `awb: null`; the waybill,
// and every state after it, only exist once a courier accepts the pickup. This cron sweeps the orders
// that are booked but not yet finished, pulls KiriminAja tracking, fills the AWB when it lands, and
// advances the order to match the courier — all through lib/ka-tracking, the same path the webhook uses.
//
// Schedule it like cron/billing (external cron → GET with the secret). Idempotent: syncOrderFromKa only
// moves an order FORWARD, so re-running is a no-op once the courier state is caught up.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 100; // cap per run — each item is a live KiriminAja call; a huge sweep risks rate-limiting

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
  const orders = await db
    .select({ number: schema.orders.number, kaOrderId: schema.orders.kaOrderId, awb: schema.orders.awb })
    .from(schema.orders)
    .where(and(isNotNull(schema.orders.kaOrderId), inArray(schema.orders.status, ["diproses", "dikirim"])))
    .limit(BATCH);

  let advanced = 0;
  let awbFilled = 0;
  let problems = 0;
  const errors: string[] = [];
  for (const o of orders) {
    const ref = o.kaOrderId ?? o.awb;
    if (!ref) continue;
    const r = await kaTrack(ref);
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
