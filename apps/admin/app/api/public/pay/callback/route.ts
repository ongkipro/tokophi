import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, eq, ne, or } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { rateLimit } from "@tokophi/lib/cache";
import { addMonths } from "@tokophi/lib/billing";
import { clientIp } from "@/lib/public-guard";

// AutoLaris payment callback — POSTed when a bill is paid/expired. Matches by trx_id / reff_id
// and updates the payment row. Idempotent; always 200 (for authorized callers) so AutoLaris
// doesn't retry forever. (Public URL needed in prod; locally AutoLaris can't reach localhost.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// constant-time compare for the shared secret (avoids length/timing leaks).
function secretOk(provided: string | null): boolean {
  const expected = process.env.AUTOLARIS_CALLBACK_SECRET;
  // No secret configured (dev/local) → allow, but warn: prod MUST set this. In prod this endpoint
  // marks orders PAID, so an unauthenticated caller could forge payment without the guard.
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[pay/callback] AUTOLARIS_CALLBACK_SECRET unset in production — callback is UNVERIFIED.");
    }
    return true;
  }
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
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

  let body: { trx_id?: string; reff_id?: string; status?: string; paid_at?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* tolerate form-encoded / empty */
  }
  const trx = body.trx_id;
  const reff = body.reff_id;
  const status = (body.status ?? "").toUpperCase();
  if (trx || reff) {
    const mapped = status === "PAID" ? "berhasil" : status === "EXPIRED" ? "gagal" : null;
    if (mapped) {
      const match = or(
        trx ? eq(schema.payments.trxId, trx) : undefined,
        reff ? eq(schema.payments.reffId, reff) : undefined,
      );
      const rows = await db
        .update(schema.payments)
        // idempotent: don't re-process a payment already in the target state (avoids paidAt churn
        // + re-firing order sync on AutoLaris retries)
        .set({ status: mapped, paidAt: mapped === "berhasil" ? new Date() : null })
        .where(and(match, ne(schema.payments.status, mapped)))
        .returning({ orderId: schema.payments.orderId });
      // sync the linked order's financial status when newly paid
      if (mapped === "berhasil") {
        const orderIds = rows.map((r) => r.orderId).filter((id): id is string => !!id);
        for (const oid of orderIds) {
          await db.update(schema.orders).set({ financialStatus: "dibayar" }).where(eq(schema.orders.id, oid));
        }
      }

      // subscription invoice? → mark paid + extend the store's subscription one month.
      const invStatus = mapped === "berhasil" ? ("dibayar" as const) : ("gagal" as const);
      const invMatch = or(
        trx ? eq(schema.invoices.trxId, trx) : undefined,
        reff ? eq(schema.invoices.reffId, reff) : undefined,
      );
      const invRows = await db
        .update(schema.invoices)
        .set({ status: invStatus, paidAt: mapped === "berhasil" ? new Date() : null })
        .where(and(invMatch, eq(schema.invoices.kind, "subscription"), ne(schema.invoices.status, invStatus)))
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
}
