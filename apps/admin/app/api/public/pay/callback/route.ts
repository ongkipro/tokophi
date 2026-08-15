import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, inArray, ne, notInArray, or } from "drizzle-orm";
import { rateLimit } from "@tokophi/lib/cache";
import { addMonths } from "@tokophi/lib/billing";
import { payCallbackAmountMatches, verifyPayCallbackSecret } from "@tokophi/lib/pay-callback";
import { clientIp, readPublicBody } from "@/lib/public-guard";
import { creditSaleForPayment } from "@/lib/ledger-credit";
import { releasePurchase } from "@/lib/tracking-events";

// AutoLaris payment callback — POSTed when a bill is paid/expired. Matches by trx_id / reff_id
// and updates the payment row. Idempotent; always 200 (for authorized callers) so AutoLaris
// doesn't retry forever. (Public URL needed in prod; locally AutoLaris can't reach localhost.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// constant-time compare for the shared secret (avoids length/timing leaks).
function secretOk(provided: string | null): boolean {
  const expected = process.env.AUTOLARIS_CALLBACK_SECRET;

  // FAIL CLOSED in production. This endpoint marks orders PAID and extends store subscriptions —
  // if the secret is ever missing (fresh env, cleared var, typo on redeploy) an unauthenticated
  // caller could forge payment for free goods. This used to `return true` and merely log a
  // warning, which is a landmine: the failure is silent and nobody reads warnings.
  // Dev/local still runs without a secret so the flow can be exercised offline.
  if (!expected && process.env.NODE_ENV === "production") {
    console.error("[pay/callback] AUTOLARIS_CALLBACK_SECRET unset in production — REJECTING callback.");
  }
  return verifyPayCallbackSecret(provided, expected, process.env.NODE_ENV !== "production");
}

export async function POST(req: Request) {
  try {
  // rate-limit forged/brute callback attempts per IP
  if (!rateLimit(`paycb:${clientIp(req)}`, 60, 60_000).ok) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  // Interim auth: shared secret via header (X-Callback-Token) or query (?token=). Swap for the
  // real AutoLaris HMAC signature once the vendor confirms the signing spec (see PROD_PLAN §7).
  const url = new URL(req.url);
  const provided = req.headers.get("x-callback-token") ?? url.searchParams.get("token");
  if (!secretOk(provided)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Capped read — see `lib/public-guard.ts`. A real callback is four scalar fields; nothing bounded
  // what an unauthenticated caller could push through `req.json()` before the secret check even ran.
  // (It runs first now, but the cap costs nothing and this endpoint must not be the exception.)
  let body: { trx_id?: string; reff_id?: string; status?: string; paid_at?: string; amount?: unknown } = {};
  const raw = await readPublicBody(req, {});
  if (raw.res) return raw.res;
  try {
    body = JSON.parse(raw.text);
  } catch {
    /* tolerate form-encoded / empty */
  }
  const trx = body.trx_id;
  const reff = body.reff_id;
  const status = (body.status ?? "").toUpperCase();
  if (trx || reff) {
    const mapped = status === "PAID" ? "berhasil" : status === "EXPIRED" ? "gagal" : null;
    if (mapped) {
      // Exact identity resolution: prefer trx_id if provided, fall back to reff_id.
      // Do NOT use OR queries that can ambiguously match multiple unrelated payment rows.
      const match = trx
        ? eq(schema.payments.trxId, trx)
        : reff
        ? eq(schema.payments.reffId, reff)
        : undefined;

      if (!match) {
        return NextResponse.json({ ok: false, error: "missing transaction identifier" }, { status: 400 });
      }

      const candidates = await db
        .select({
          id: schema.payments.id,
          orderId: schema.payments.orderId,
          amountIdr: schema.payments.amountIdr,
        })
        .from(schema.payments)
        .where(match);

      if (candidates.length > 1) {
        console.error("[pay/callback] Ambiguous callback match resolved to multiple payment rows — rejected.");
        return NextResponse.json({ ok: false, error: "ambiguous payment match" }, { status: 400 });
      }
      const matched = mapped === "berhasil"
        ? candidates.filter((payment) => payCallbackAmountMatches(body.amount, payment.amountIdr))
        : candidates;

      if (mapped === "berhasil" && matched.length !== candidates.length) {
        console.error("[pay/callback] PAID amount does not match payments.amount_idr — callback ignored.");
      }

      const rows = matched.length === 0
        ? []
        : await db
          .update(schema.payments)
          // idempotent: don't re-process a payment already in the target state (avoids paidAt churn
          // + re-firing order sync on AutoLaris retries)
          .set({ status: mapped, paidAt: mapped === "berhasil" ? new Date() : null })
          // ⚠️ FORWARD ONLY OUT OF `berhasil`. `ne(status, mapped)` blocks a same-state replay and nothing
          // else, so a late or replayed EXPIRED walked a COLLECTED payment back to `gagal` and nulled its
          // `paid_at` — while `orders.financial_status` stayed `dibayar` and the ledger kept the credit.
          // Three sources of truth, three answers, and the merchant's Keuangan screen the only one wrong.
          // A VA lives 24 h and `applyOrderStatusChange` also writes `gagal`, so the out-of-order pair is
          // ordinary, not exotic. Money that has been received is not un-received by a webhook.
          .where(and(
            inArray(schema.payments.id, matched.map((payment) => payment.id)),
            ne(schema.payments.status, mapped),
            ne(schema.payments.status, "berhasil"),
          ))
          .returning({ id: schema.payments.id, orderId: schema.payments.orderId });
      // sync the linked order's financial status when newly paid
      if (mapped === "berhasil") {
        const orderIds = rows.map((r) => r.orderId).filter((id): id is string => !!id);
        for (const oid of orderIds) {
          // ⚠️ NOT ON A CANCELLED OR RETURNED ORDER. This update used to be unconditional, so a PAID
          // callback arriving after the merchant cancelled stamped `dibayar` on a `batal` order — which
          // then sat in Pesanan badged "Dibayar" with NO ledger row, because `creditSaleForPayment`
          // (correctly) refuses terminal orders. The money is in the platform's account, never enters
          // the merchant's book and never leaves; nothing in the product writes `refund` either.
          // Reachable by ordinary timing: a VA lives 24 h and cancelling sets the payment to `gagal`,
          // so `gagal → berhasil` fires long afterwards. Flagging it beats silently mislabelling it.
          const done = await db
            .update(schema.orders)
            .set({ financialStatus: "dibayar" })
            .where(and(eq(schema.orders.id, oid), notInArray(schema.orders.status, ["batal", "retur"])))
            .returning({ id: schema.orders.id });
          if (done.length === 0) {
            console.error(`[pay/callback] PAID arrived for a cancelled/returned order ${oid} — money collected, NOT credited. Needs a refund decision.`);
          }
        }
        // Conversion tracking (ADR 0012 §14.4): a PREPAID order becomes a Purchase HERE — when the
        // money is confirmed — not on the browser's success page, which shows an unpaid VA number.
        // The row itself was created at checkout (that is the only moment the shopper's browser context
        // exists) and held; this releases it.
        //
        // Deliberately over `matched`, NOT `rows`: `rows` is only the state TRANSITION, which happens
        // once. If the release failed on that one callback, an AutoLaris retry would find nothing to
        // transition and the conversion would be lost forever. `releasePurchase` is idempotent.
        // Non-fatal: a marketing row must never fail a payment callback.
        for (const m of matched) {
          if (!m.orderId) continue;
          try {
            const [o] = await db
              .select({ storeId: schema.orders.storeId })
              .from(schema.orders)
              .where(eq(schema.orders.id, m.orderId))
              .limit(1);
            if (o) await releasePurchase(o.storeId, m.orderId);
          } catch (err) {
            console.error("[pay/callback] tracking release failed", err);
          }
        }
        // The money is now actually in hand → book it in the merchant's ledger (migration 0041).
        // Without this the balance stays Rp0 forever no matter how much comes in. AutoLaris retries
        // its callbacks, so this is deliberately safe to run twice: a partial unique index
        // (ledger_one_sale_per_payment) makes a second credit for the same payment impossible.
        for (const r of rows) await creditSaleForPayment(db, r.id);
      }

      // subscription invoice? → mark paid + extend the store's subscription one month.
      const invStatus = mapped === "berhasil" ? ("dibayar" as const) : ("gagal" as const);
      const invMatch = trx
        ? eq(schema.invoices.trxId, trx)
        : reff
        ? eq(schema.invoices.reffId, reff)
        : undefined;
      const invoiceCandidates = await db
        .select({ id: schema.invoices.id, amountIdr: schema.invoices.amountIdr })
        .from(schema.invoices)
        .where(and(invMatch, eq(schema.invoices.kind, "subscription")));
      const invoiceMatches = mapped === "berhasil"
        ? invoiceCandidates.filter((invoice) => payCallbackAmountMatches(body.amount, invoice.amountIdr))
        : invoiceCandidates;

      if (mapped === "berhasil" && invoiceMatches.length !== invoiceCandidates.length) {
        console.error("[pay/callback] PAID amount does not match invoices.amount_idr — callback ignored.");
      }

      const invRows = invoiceMatches.length === 0
        ? []
        : await db
          .update(schema.invoices)
          .set({ status: invStatus, paidAt: mapped === "berhasil" ? new Date() : null })
          .where(and(
            inArray(schema.invoices.id, invoiceMatches.map((invoice) => invoice.id)),
            ne(schema.invoices.status, invStatus),
          ))
          .returning({ storeId: schema.invoices.storeId, periodMonths: schema.invoices.periodMonths });
      if (mapped === "berhasil") {
        for (const r of invRows) {
          if (!r.storeId) continue;
          // extend from the later of "now" or the remaining period, by the invoice's months
          const [s] = await db.select({ cpe: schema.stores.currentPeriodEnd }).from(schema.stores).where(eq(schema.stores.id, r.storeId)).limit(1);
          const now = new Date();
          const base = s?.cpe && s.cpe > now ? s.cpe : now;
          await db
            .update(schema.stores)
            .set({ currentPeriodEnd: addMonths(base, r.periodMonths ?? 1), firstInvoicePaid: true, status: "active" })
            .where(eq(schema.stores.id, r.storeId));
        }
      }
    }
  }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[pay/callback] handler error", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
