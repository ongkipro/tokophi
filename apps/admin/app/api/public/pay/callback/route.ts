import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, inArray, ne, notInArray, or } from "drizzle-orm";
import { rateLimit } from "@tokophi/lib/cache";
import { addMonths } from "@tokophi/lib/billing";
import {
  PAY_CALLBACK_PARAM,
  payCallbackAmountMatches,
  payCallbackBodyShape,
  verifyPayCallbackRef,
  verifyPayCallbackSecret,
} from "@tokophi/lib/pay-callback";
import { clientIp, readPublicBody } from "@/lib/public-guard";
import { creditSaleForPayment } from "@/lib/ledger-credit";
import { releasePurchase } from "@/lib/tracking-events";

// AutoLaris payment callback — POSTed when a bill is paid/expired. Matches by trx_id / reff_id
// and updates the payment row. Idempotent; always 200 (for authorized callers) so AutoLaris
// doesn't retry forever. (Public URL needed in prod; locally AutoLaris can't reach localhost.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How this request proved it may move money.
 *
 * `boundRef` is the whole point of the split. A `signature` caller proved it holds the URL we minted
 * for ONE reference, so it may only act on the row carrying that `reff_id`. `header` and
 * `query-token` carry the reusable secret itself and are therefore unbound — which is exactly why
 * nothing mints a query token any more.
 */
type CallbackAuth =
  | { ok: true; via: "header" | "signature" | "query-token" | "dev-unauthenticated"; boundRef: string | null }
  | { ok: false };

/**
 * 🔴 THE `?token=` DOOR IS KNOWINGLY OPEN AND IT IS BLOCKED ON THE VENDOR. DO NOT CLOSE IT HERE.
 *
 * AutoLaris sends `callback_url` back verbatim and attaches no headers of its own. Until the vendor
 * confirms it can send `X-Callback-Token` (or its own HMAC signature — PROD_PLAN §7), removing this
 * branch would 401 **every genuine payment**: the shopper pays their VA, `payments.status` stays
 * `menunggu` for ever, the order never becomes `dibayar`, no ledger row is written, and the platform's
 * own subscription invoices stop advancing `stores.current_period_end`. That outage has happened here
 * once already. A hardening that refuses real money is worse than the hole it closes.
 *
 * What was ours to fix, and IS fixed (Task 4.13 / SEC-16, 2026-08-21): we no longer MINT one.
 * `payCallbackUrl()` now signs the reference instead of embedding `AUTOLARIS_CALLBACK_SECRET`, so no
 * new bill puts a reusable platform credential into a URL, a gateway dashboard or a proxy log. This
 * branch survives for the bills that were created BEFORE that change and are still inside their 24 h
 * VA life — and for the vendor behaviour we have not been able to change. Every use is logged, so
 * "is anything still arriving on the old door?" is a question the logs can answer rather than a guess.
 *
 * ⚠️ It is also the WEAKEST of the three: unlike a signature it is unbound, so anyone holding one of
 * those old URLs can act on ANY payment. That is the cost of not breaking live payments, and it is
 * why it is written down here instead of being quietly tolerated.
 * Pinned by `route.test.ts` → "the legacy ?token= door".
 */
function authorizeCallback(req: Request, url: URL): CallbackAuth {
  const expected = process.env.AUTOLARIS_CALLBACK_SECRET;

  // FAIL CLOSED in production. This endpoint marks orders PAID and extends store subscriptions —
  // if the secret is ever missing (fresh env, cleared var, typo on redeploy) an unauthenticated
  // caller could forge payment for free goods. This used to `return true` and merely log a
  // warning, which is a landmine: the failure is silent and nobody reads warnings.
  // Dev/local still runs without a secret so the flow can be exercised offline.
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      console.error("[pay/callback] AUTOLARIS_CALLBACK_SECRET unset in production — REJECTING callback.");
      return { ok: false };
    }
    return { ok: true, via: "dev-unauthenticated", boundRef: null };
  }

  // 1. The documented path. A header keeps the credential out of every URL-shaped log there is.
  if (verifyPayCallbackSecret(req.headers.get("x-callback-token"), expected)) {
    return { ok: true, via: "header", boundRef: null };
  }

  // 2. What we mint today: a signature over the reference this bill was raised under.
  const signedRef = verifyPayCallbackRef(url.searchParams.get(PAY_CALLBACK_PARAM), expected);
  if (signedRef) return { ok: true, via: "signature", boundRef: signedRef };

  // 3. The legacy door — see the note above. Logged on every use, never the value.
  if (verifyPayCallbackSecret(url.searchParams.get("token"), expected)) {
    console.warn(
      "[pay/callback] DEPRECATED: authenticated by the reusable ?token= query parameter. " +
        "Nothing mints these any more; this is an old bill or the vendor's own configuration.",
    );
    return { ok: true, via: "query-token", boundRef: null };
  }

  return { ok: false };
}

/**
 * A signed callback may only touch the row its signature names.
 *
 * Without this the signature is just a bearer token with extra steps: whoever reads ONE minted URL
 * could post any `trx_id` at it and mark that payment paid. The comparison is against the row we
 * RESOLVED, not against the request body, so it holds whether AutoLaris echoes `trx_id`, `reff_id`
 * or both — the row carries the reference we billed under either way.
 *
 * An empty candidate list is bound trivially: there is nothing to act on, and the caller already
 * passed authentication.
 */
function bound(auth: CallbackAuth & { ok: true }, rows: { reffId: string | null }[]): boolean {
  if (auth.boundRef === null) return true;
  return rows.every((row) => row.reffId === auth.boundRef);
}

export async function POST(req: Request) {
  try {
  // rate-limit forged/brute callback attempts per IP
  if (!rateLimit(`paycb:${clientIp(req)}`, 60, 60_000).ok) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  // Header · per-payment signature · the vendor-blocked legacy `?token=`. See `authorizeCallback`.
  const url = new URL(req.url);
  const auth = authorizeCallback(req, url);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Capped read — see `lib/public-guard.ts`. A real callback is four scalar fields; nothing bounded
  // what an unauthenticated caller could push through `req.json()` before the secret check even ran.
  // (It runs first now, but the cap costs nothing and this endpoint must not be the exception.)
  let body: { trx_id?: string; transaction_id?: string; reff_id?: string; status?: string; paid_at?: string; amount?: unknown } = {};
  const raw = await readPublicBody(req, {});
  if (raw.res) return raw.res;
  try {
    body = JSON.parse(raw.text);
  } catch {
    /* tolerate form-encoded / empty */
  }
  // A trimmed empty string is NOT an identifier. `body.trx_id = ""` used to fall through to `reff`
  // silently; naming it here is what makes the ZERO-IDENTITY branch below reachable and testable.
  // Two eras coexist: create_payment callbacks say `trx_id`; /api/h2h/submit (digital orders,
  // AL-ORDER 2026-08-24) issues `transaction_id`. Same identifier family, same column — read both,
  // trx_id first so nothing changes for the era already in production.
  const trxRaw = typeof body.trx_id === "string" && body.trx_id.trim() ? body.trx_id : (typeof body.transaction_id === "string" ? body.transaction_id : "");
  const trx = trxRaw.trim();
  const reff = typeof body.reff_id === "string" ? body.reff_id.trim() : "";
  const status = (body.status ?? "").toUpperCase();

  // ZERO IDENTITY IS A REFUSAL, NOT A SHRUG. An authenticated caller that names no payment used to
  // get `{ok:true}` and a 200 — indistinguishable, from the outside, from a callback we acted on.
  // Nothing here can be done without exactly one identifier, so say so.
  if (!trx && !reff) {
    console.error("[pay/callback] callback carried neither trx_id nor reff_id — rejected.");
    return NextResponse.json({ ok: false, error: "missing transaction identifier" }, { status: 400 });
  }

  {
    const mapped = status === "PAID" ? "berhasil" : status === "EXPIRED" ? "gagal" : null;
    if (mapped) {
      // Exact identity resolution: prefer trx_id if provided, fall back to reff_id.
      // Do NOT use OR queries that can ambiguously match multiple unrelated payment rows.
      const match = trx ? eq(schema.payments.trxId, trx) : eq(schema.payments.reffId, reff);

      const candidates = await db
        .select({
          id: schema.payments.id,
          orderId: schema.payments.orderId,
          amountIdr: schema.payments.amountIdr,
          // Read back so a SIGNED callback can be bound to the row it names — see `bound()`.
          reffId: schema.payments.reffId,
        })
        .from(schema.payments)
        .where(match);

      if (candidates.length > 1) {
        console.error("[pay/callback] Ambiguous callback match resolved to multiple payment rows — rejected.");
        return NextResponse.json({ ok: false, error: "ambiguous payment match" }, { status: 400 });
      }
      if (!bound(auth, candidates)) {
        console.error("[pay/callback] signed callback does not name the payment it resolved — rejected.");
        return NextResponse.json({ ok: false, error: "callback signature does not match this payment" }, { status: 403 });
      }
      const matched = mapped === "berhasil"
        ? candidates.filter((payment) => payCallbackAmountMatches(body.amount, payment.amountIdr))
        : candidates;

      if (mapped === "berhasil" && matched.length !== candidates.length) {
        console.error("[pay/callback] PAID amount does not match payments.amount_idr — callback ignored.");
        // F9: the SHAPE of what arrived (names, types, lengths — never a value), so the first real
        // rejection explains itself. Same discipline as the KiriminAja webhook's rejection line.
        for (const p of candidates) console.error(`[pay/callback] paid-amount-mismatch shape=${payCallbackBodyShape(body, p.amountIdr)}`);
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
      const invMatch = trx ? eq(schema.invoices.trxId, trx) : eq(schema.invoices.reffId, reff);
      const invoiceCandidates = await db
        .select({ id: schema.invoices.id, amountIdr: schema.invoices.amountIdr, reffId: schema.invoices.reffId })
        .from(schema.invoices)
        .where(and(invMatch, eq(schema.invoices.kind, "subscription")));

      // The same two rules the payment half gets, and for the same reasons. This branch had NEITHER:
      // an ambiguous `trx_id` would have paid several subscription invoices at once, and a signed
      // callback for one store's invoice could have settled another's.
      if (invoiceCandidates.length > 1) {
        console.error("[pay/callback] Ambiguous callback match resolved to multiple subscription invoices — rejected.");
        return NextResponse.json({ ok: false, error: "ambiguous invoice match" }, { status: 400 });
      }
      if (!bound(auth, invoiceCandidates)) {
        console.error("[pay/callback] signed callback does not name the invoice it resolved — rejected.");
        return NextResponse.json({ ok: false, error: "callback signature does not match this invoice" }, { status: 403 });
      }
      const invoiceMatches = mapped === "berhasil"
        ? invoiceCandidates.filter((invoice) => payCallbackAmountMatches(body.amount, invoice.amountIdr))
        : invoiceCandidates;

      if (mapped === "berhasil" && invoiceMatches.length !== invoiceCandidates.length) {
        console.error("[pay/callback] PAID amount does not match invoices.amount_idr — callback ignored.");
        for (const i of invoiceCandidates) console.error(`[pay/callback] paid-amount-mismatch shape=${payCallbackBodyShape(body, i.amountIdr)}`);
      }

      const invRows = invoiceMatches.length === 0
        ? []
        : await db
          .update(schema.invoices)
          .set({ status: invStatus, paidAt: mapped === "berhasil" ? new Date() : null })
          // ⚠️ `dibayar` IS TERMINAL FOR A CALLBACK — the same rule the payments branch above already
          // enforces with `ne(status, "berhasil")`, and for the same reason: money that has been
          // received is not un-received by a webhook. Without this line `ne(status, invStatus)` was
          // the ONLY guard, so a late EXPIRED walked a paid invoice to `gagal` AND nulled its
          // `paid_at` — and the paid → expired → paid sequence then extended the store's
          // subscription a SECOND time, because the second PAID found a non-`dibayar` row to claim.
          // A VA lives 24 h, so out-of-order pairs are ordinary here, not exotic (Task 4.10).
          .where(and(
            inArray(schema.invoices.id, invoiceMatches.map((invoice) => invoice.id)),
            ne(schema.invoices.status, invStatus),
            ne(schema.invoices.status, "dibayar"),
          ))
          .returning({ storeId: schema.invoices.storeId, periodMonths: schema.invoices.periodMonths });
      if (mapped === "berhasil") {
        for (const r of invRows) {
          if (!r.storeId) continue;
          // extend from the later of "now" or the remaining period, by the invoice's months.
          //
          // ⚠️ READ AND WRITE UNDER ONE ROW LOCK. This arithmetic is a read-modify-write, and the
          // claim above only serialises callbacks for the SAME invoice. Two DIFFERENT invoices of one
          // store paid at the same moment both read the same `current_period_end`, both add their
          // months to it, and the second write erases the first — the merchant pays twice and is
          // credited once. `for update` inside a transaction makes the second reader wait for the
          // first to commit and then read the extended value.
          //
          // The month arithmetic deliberately stays in `addMonths` rather than moving into SQL:
          // Postgres' `+ interval '1 month'` CLAMPS (31 Jan + 1 = 28 Feb) where JS `setMonth`
          // OVERFLOWS (→ 3 Mar). Both are defensible; silently swapping one for the other inside a
          // race fix is not.
          await db.transaction(async (tx) => {
            const [s] = await tx
              .select({ cpe: schema.stores.currentPeriodEnd })
              .from(schema.stores)
              .where(eq(schema.stores.id, r.storeId!))
              .for("update")
              .limit(1);
            const now = new Date();
            const base = s?.cpe && s.cpe > now ? s.cpe : now;
            await tx
              .update(schema.stores)
              .set({ currentPeriodEnd: addMonths(base, r.periodMonths ?? 1), firstInvoicePaid: true, status: "active" })
              .where(eq(schema.stores.id, r.storeId!));
          });
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
