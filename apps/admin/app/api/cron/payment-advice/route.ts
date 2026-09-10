import { db, schema } from "@tokophi/db";
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { alAdvice, autolarisConfigured, classifyAdvice, type AdviceOutcome } from "@tokophi/lib/autolaris";
import { cronAuthorized } from "@/lib/cron-auth";
import { cronIntervalSec, recordCronRun } from "../record-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── PAYMENT RECONCILIATION — THE OBSERVE-ONLY HALF ─────────────────────────────────────────────────
//
// The vendor guide (ongkipro/autolaris, payment-gateway.md §6) prescribes exactly this loop: read the
// local `pending`/`expired` transactions that carry a provider `transaction_id`, call `/advice` for
// each, BOUNDED and IDEMPOTENT, and let ONLY an explicitly confirmed settlement status mark anything
// paid. `alAdvice` and `classifyAdvice` shipped on 2026-09-09; until today nothing called them.
//
// 🔴 THIS ROUTE WRITES NOTHING TO `payments` OR `invoices`, AND THAT IS THE DESIGN, NOT A GAP.
// Measured 2026-09-09 against four real provider ids: every one answered `{"rc":"02","ket":"FAILED"}`
// — including two bills our own database held LIVE and unpaid — and no PAID answer has ever been
// observed from this account. So `failed` from `advice` does not track our state, and acting on it
// would kill legitimate bills; `paid` cannot occur at all while `ADVICE_SETTLED` is empty, which it
// is by construction until AutoLaris answers go-live question #6 ("mapping lengkap code/status
// Advice, dan kombinasi mana yang final paid"). Settlement stays where it has always been decided:
// `api/public/pay/callback` (`status === "PAID"` → `berhasil` → `creditSaleForPayment`).
//
// What this loop DOES do is make the answer distribution visible in `cron_runs.result` on the Super
// Admin cron card — so the first time a real prepaid bill settles, the operator can read what `rc`/
// `ket` the provider returned for it, and question #6 gets answered by evidence rather than by
// asking. A log nobody reads is not a signal; a counter on a screen somebody already has open is.
//
// Bounded three ways: MAX_PER_TICK rows, sequential calls, and the 15 s timeout inside `al()` —
// worst case 40 × 15 s = 10 min, under the sidecar's 15-minute cadence. Production holds six
// candidates today.
const MAX_PER_TICK = 40;
const SAMPLE_MAX = 20;

type Candidate = { kind: "payment" | "invoice"; id: string; trxId: string; storeId: string | null };

type AdviceSummary = {
  scanned: number;
  asked: number;
  transportErrors: number;
  outcomes: Record<AdviceOutcome, number>;
  /** exact provider answers, e.g. `"rc=02 ket=FAILED": 6` — the raw material for question #6 */
  answers: Record<string, number>;
  /** first SAMPLE_MAX rows with their answer, so an operator can name a transaction */
  sample: { kind: Candidate["kind"]; id: string; trxId: string; rc: string; ket: string; outcome: AdviceOutcome }[];
  errors: number;
};

async function candidates(): Promise<Candidate[]> {
  // Prepaid only: a COD row has no provider transaction and `method <> 'cod'` says so explicitly
  // rather than trusting `trx_id IS NOT NULL` alone. Oldest first, so a bill that has waited longest
  // is never starved by newer ones when the cap binds.
  const pays = await db
    .select({ id: schema.payments.id, trxId: schema.payments.trxId, storeId: schema.payments.storeId })
    .from(schema.payments)
    .where(and(eq(schema.payments.status, "menunggu"), isNotNull(schema.payments.trxId), ne(schema.payments.method, "cod")))
    .orderBy(asc(schema.payments.id))
    .limit(MAX_PER_TICK);
  const invs = await db
    .select({ id: schema.invoices.id, trxId: schema.invoices.trxId, storeId: schema.invoices.storeId })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.status, "menunggu"), isNotNull(schema.invoices.trxId)))
    .orderBy(asc(schema.invoices.id))
    .limit(MAX_PER_TICK);
  const all: Candidate[] = [
    ...pays.map((p) => ({ kind: "payment" as const, id: p.id, trxId: p.trxId ?? "", storeId: p.storeId })),
    ...invs.map((i) => ({ kind: "invoice" as const, id: i.id, trxId: i.trxId ?? "", storeId: i.storeId })),
  ];
  return all.filter((c) => c.trxId).slice(0, MAX_PER_TICK);
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  if (!cronAuthorized(req, "cron/payment-advice")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const summary: AdviceSummary = {
    scanned: 0,
    asked: 0,
    transportErrors: 0,
    outcomes: { paid: 0, pending: 0, failed: 0, unknown: 0 },
    answers: {},
    sample: [],
    errors: 0,
  };

  if (!autolarisConfigured()) {
    await recordCronRun("payment-advice", { ok: false, startedAt, intervalSec: cronIntervalSec(req), result: { error: "Payment gateway belum dikonfigurasi." } });
    return NextResponse.json({ ok: false, error: "Payment gateway belum dikonfigurasi." }, { status: 200 });
  }

  try {
    const rows = await candidates();
    summary.scanned = rows.length;
    for (const c of rows) {
      const a = await alAdvice(c.trxId);
      if (!a.ok) {
        summary.transportErrors += 1;
        continue;
      }
      summary.asked += 1;
      const { outcome } = classifyAdvice(a.rc, a.ket);
      summary.outcomes[outcome] += 1;
      const key = `rc=${a.rc || "?"} ket=${(a.ket || "?").toUpperCase()}`;
      summary.answers[key] = (summary.answers[key] ?? 0) + 1;
      if (summary.sample.length < SAMPLE_MAX) summary.sample.push({ kind: c.kind, id: c.id, trxId: c.trxId, rc: a.rc, ket: a.ket, outcome });
      // A settlement word would be news: ADVICE_SETTLED is empty, so this branch is unreachable
      // today, and when the vendor confirms a mapping it must STILL not settle from here — the
      // callback route is the one writer. It is logged loudly precisely because it is unexpected.
      if (outcome === "paid") console.error(`[cron/payment-advice] SETTLEMENT ANSWER for ${c.kind} ${c.id} trx ${c.trxId}: ${key} — not acted on here; verify via pay/callback path`);
    }
    await recordCronRun("payment-advice", { ok: true, startedAt, intervalSec: cronIntervalSec(req), result: summary });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    summary.errors += 1;
    console.error("[cron/payment-advice] sweep failed", error);
    await recordCronRun("payment-advice", { ok: false, startedAt, intervalSec: cronIntervalSec(req), result: summary });
    return NextResponse.json({ ok: false, ...summary }, { status: 200 });
  }
}
