import { db, schema } from "@tokophi/db";
import { and, asc, eq, exists, lte, ne, notExists } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { applyOrderStatusChange } from "@/lib/order-status";
import { cronIntervalSec, recordCronRun } from "../record-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDER_TTL_MS = 24 * 60 * 60 * 1000;

type ExpirySummary = {
  scanned: number;
  cancelled: number;
  skipped: number;
  errors: number;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");

  // A production worker that changes orders and inventory must fail closed when its secret is absent.
  if (!secret) return process.env.NODE_ENV !== "production";
  return provided === secret;
}

/**
 * Cancel one candidate while holding both its order and payment rows.
 *
 * The candidate query is only a work queue. Eligibility is re-read under locks here so an overlapping
 * cron tick cannot restore stock twice and a payment callback that won the payment-row lock cannot be
 * cancelled from a stale snapshot. applyOrderStatusChange performs the order write, payment failure,
 * inventory restore, and ledger effects on this same transaction.
 */
async function expireCandidate(orderId: string, cutoff: Date): Promise<"cancelled" | "skipped"> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: schema.orders.id,
        storeId: schema.orders.storeId,
        status: schema.orders.status,
        financialStatus: schema.orders.financialStatus,
        placedAt: schema.orders.placedAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .for("update")
      .limit(1);

    if (
      !order ||
      order.status !== "baru" ||
      order.financialStatus !== "pending" ||
      order.placedAt.getTime() > cutoff.getTime()
    ) {
      return "skipped";
    }

    // Lock every payment before deciding. A successful payment anywhere on the order wins, even if an
    // older VA attempt is still menunggu/gagal. Conversely, once this lock is ours, a late callback
    // waits until cancellation commits and reaches the callback's explicit terminal-order alert path.
    const payments = await tx
      .select({ method: schema.payments.method, status: schema.payments.status })
      .from(schema.payments)
      .where(eq(schema.payments.orderId, order.id))
      .for("update");

    const isPrepaid = payments.some((payment) => payment.method !== "cod");
    const isPaid = payments.some((payment) => payment.status === "berhasil");
    if (!isPrepaid || isPaid) return "skipped";

    const result = await applyOrderStatusChange(
      tx as unknown as Parameters<typeof applyOrderStatusChange>[0],
      {
        storeId: order.storeId,
        order: { id: order.id, status: order.status },
        status: "batal",
      },
    );
    return result.applied ? "cancelled" : "skipped";
  });
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const summary: ExpirySummary = { scanned: 0, cancelled: 0, skipped: 0, errors: 0 };
  const cutoff = new Date(startedAt - ORDER_TTL_MS);

  try {
    // There is no persisted gateway `expires_at` in the current schema. AutoLaris creates every
    // prepaid instrument with a 24-hour TTL, so orders.placed_at is the durable fallback clock. The
    // EXISTS clauses deliberately identify payment METHOD rather than trusting financial_status alone:
    // COD also stays pending until delivery and must never be reclaimed by this worker.
    const prepaidPayment = db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(and(eq(schema.payments.orderId, schema.orders.id), ne(schema.payments.method, "cod")));
    const successfulPayment = db
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(and(eq(schema.payments.orderId, schema.orders.id), eq(schema.payments.status, "berhasil")));

    const candidates = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, "baru"),
          eq(schema.orders.financialStatus, "pending"),
          lte(schema.orders.placedAt, cutoff),
          exists(prepaidPayment),
          notExists(successfulPayment),
        ),
      )
      .orderBy(asc(schema.orders.placedAt));

    summary.scanned = candidates.length;
    for (const candidate of candidates) {
      try {
        const outcome = await expireCandidate(candidate.id, cutoff);
        summary[outcome] += 1;
      } catch (error) {
        summary.errors += 1;
        console.error("[cron/order-expiry] failed to expire order", candidate.id, error);
      }
    }

    await recordCronRun("order-expiry", {
      ok: summary.errors === 0,
      startedAt,
      intervalSec: cronIntervalSec(req),
      result: summary,
    });
    return NextResponse.json({ ok: summary.errors === 0, ...summary });
  } catch (error) {
    summary.errors += 1;
    console.error("[cron/order-expiry] sweep failed", error);
    await recordCronRun("order-expiry", {
      ok: false,
      startedAt,
      intervalSec: cronIntervalSec(req),
      result: summary,
    });
    return NextResponse.json({ ok: false, ...summary }, { status: 500 });
  }
}
