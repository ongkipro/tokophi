import { NextResponse, type NextRequest } from "next/server";
import { db } from "@tokophi/db";
import { sql } from "drizzle-orm";
import { KaTransportError, kaTrack, kiriminajaConfigured } from "@tokophi/lib/kiriminaja";
import { outcomeFromTrackingCode, syncOrderFromKa } from "@/lib/ka-tracking";
import { cronIntervalSec, recordCronRun } from "../record-run";
import { cronAuthorized } from "@/lib/cron-auth";

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

// Each store gets its own bounded slice. The query interleaves slice position across stores, so a
// busy merchant cannot consume the whole tick before another merchant receives even one poll.
const PER_STORE_BATCH = 5;

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

// Client errors are retryable only when the protocol explicitly says "try later" or the current
// resource state may change. Every other 4xx is a permanent rejection of this tracking request.
const RETRYABLE_4XX: Record<number, true> = { 408: true, 409: true, 423: true, 425: true, 429: true };

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  // FAIL CLOSED in production, exactly like cron/billing: an unset secret must mean NO, not "no gate".
  if (!cronAuthorized(req, "cron/tracking")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
  // which is precisely why this branch has to be RECORDED as a failed run. A poller that wakes on
  // schedule and can never fill a waybill is indistinguishable, from the outside, from one that is
  // working; on the panel it now reads red instead of "terakhir jalan 2 menit lalu".
  if (!kiriminajaConfigured()) {
    await recordCronRun("tracking", {
      ok: false,
      startedAt,
      intervalSec: cronIntervalSec(req),
      result: { error: "KiriminAja belum dikonfigurasi." },
    });
    return NextResponse.json({ ok: false, error: "KiriminAja belum dikonfigurasi." }, { status: 200 });
  }

  // Rank independently inside every store, then execute round 1 for all stores before round 2, etc.
  // Already-flagged parcels sort behind healthy work: they remain eligible for recovery polling when
  // a store has spare capacity, but a permanent rejection cannot occupy all five slots forever.
  const orders = (await db.execute(sql`
    with ranked as (
      select
        number,
        ka_order_id as "kaOrderId",
        awb,
        store_id::text as "storeId",
        row_number() over (
          partition by store_id
          order by (problem_at is not null), (awb is not null), placed_at, id
        ) as poll_round
      from orders
      where ka_order_id is not null
        and status in ('diproses', 'dikirim')
    )
    select number, "kaOrderId", awb, "storeId"
    from ranked
    where poll_round <= ${PER_STORE_BATCH}
    order by poll_round, "storeId"
  `)) as unknown as { number: string; kaOrderId: string; awb: string | null; storeId: string }[];

  let advanced = 0;
  let awbFilled = 0;
  let problems = 0;
  let problemsCleared = 0;
  const errors: string[] = [];
  const flagPermanentError = async (orderNumber: string, httpStatus: number, detail?: string) => {
    problems++;
    const suffix = detail ? `: ${detail}` : ".";
    const note = `KiriminAja menolak permintaan pelacakan secara permanen (HTTP ${httpStatus})${suffix}`;
    console.warn("[cron/tracking] permanent courier rejection", orderNumber, "HTTP", httpStatus);
    try {
      await syncOrderFromKa(orderNumber, "problem", null, note);
    } catch (err) {
      console.error("[cron/tracking] failed to flag permanent courier rejection", orderNumber, err);
      errors.push(orderNumber);
    }
  };
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
      if (
        err instanceof KaTransportError &&
        err.httpStatus >= 400 &&
        err.httpStatus < 500 &&
        !RETRYABLE_4XX[err.httpStatus]
      ) {
        logRaw({ order: o.number, ref, sentAs: o.kaOrderId ? "ka_order_id" : "awb", ok: false, httpStatus: err.httpStatus });
        await flagPermanentError(o.number, err.httpStatus);
      } else {
        console.error("[cron/tracking] tracking pull failed", o.number, err);
        errors.push(o.number);
      }
      continue;
    }
    if (!r.ok) {
      // A permanent client rejection will never heal through retries. Flag it and rank it behind
      // healthy work on later ticks; transient 4xx responses remain eligible for the next tick.
      logRaw({
        order: o.number,
        ref,
        sentAs: o.kaOrderId ? "ka_order_id" : "awb",
        ok: false,
        httpStatus: r.httpStatus,
        err: short(r.error),
      });
      if (r.httpStatus >= 400 && r.httpStatus < 500 && !RETRYABLE_4XX[r.httpStatus]) {
        const detail = short(r.error);
        await flagPermanentError(o.number, r.httpStatus, typeof detail === "string" ? detail : undefined);
      }
      continue;
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

  // The SAME summary is returned to the caller and stored. `docker logs` keeps its line; the row is
  // what a human sees without going looking. Storing the counts, not just the timestamp, is the half
  // that matters here: `awbFilled` was 0 for a week and "the cron ran" would have been true all week.
  const summary = { scanned: orders.length, advanced, awbFilled, problems, problemsCleared, errors: errors.length };
  // ⚠️ `ok` IS DERIVED FROM `errors`, NOT HARD-CODED. It was `ok: true`, so a tick in which every
  // single sync threw wrote a GREEN `cron_runs` row — over the one job whose week-long silence is
  // the reason this table exists at all. `order-expiry` beside it already computes
  // `ok: summary.errors === 0`; this route did not, and a liveness row that cannot go red is a row
  // nobody can act on.
  const ok = errors.length === 0;
  await recordCronRun("tracking", { ok, startedAt, intervalSec: cronIntervalSec(req), result: summary });
    return NextResponse.json({ ok, ...summary });
  } catch (error) {
    console.error("[cron/tracking] sweep failed", error);
    await recordCronRun("tracking", {
      ok: false,
      startedAt,
      intervalSec: cronIntervalSec(req),
      result: { error: error instanceof Error ? error.message : "sweep failed" },
    });
    return NextResponse.json({ ok: false, error: "sweep failed" }, { status: 500 });
  }
}
