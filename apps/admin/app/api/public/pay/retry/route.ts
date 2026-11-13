import { NextResponse } from "next/server";
import { db, schema } from "@tokophi/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alCreateOrder, autolarisConfigured } from "@tokophi/lib/autolaris";
import { payCallbackUrl } from "@tokophi/lib/pay-callback";
import { rateLimited, readPublicBody } from "@/lib/public-guard";
import { qrImageDataUrl } from "@/lib/pay-instruction";
import {
  payTokenMatches,
  retryDecision,
  retryReffId,
  type RetryRefusal,
} from "@/lib/pay-retry";

// PAY-RETRY — "Bayar ulang" (2026-11-13). A shopper whose QRIS / VA / e-wallet instruction EXPIRED or
// FAILED asks for a NEW instruction for the SAME order. Spec + case table:
// specs/docs/tasks/2026-11-13-pay-retry.md.
//
// The fifth public route, and it obeys the four's rules (AGENTS.md → "The public API"): no session,
// so `storeSlug` in the body selects the tenant; the body goes through `readPublicBody`; per-IP rate
// limit; CORS on every answer (the storefront is another origin); the provider's own words never
// reach the shopper (ADR 0004). What is NEW here is the authority: the order NUMBER identifies, the
// `token` the checkout handed this browser authorises (only its sha256 is stored,
// `orders.pay_token_hash`). A wrong token, an unknown order and a COD/legacy order with no token all
// get the same 404, so the endpoint is not an oracle for which order numbers exist.
//
// THE MONEY RULES — all decided under the ORDER's row lock (`retryDecision`, lib/pay-retry.ts):
//   · never while any instruction is payable or may be (live / in flight / unknown) → at most ONE
//     live bill per order, so the shopper cannot be charged twice by design;
//   · never on a paid, cancelled, returned or already-processed order, never for COD;
//   · the SAME money: amount, our admin fee and the buyer's total are copied from the previous
//     attempt — the bill the shopper agreed to at checkout, unaffected by a later fee-schedule change;
//   · the SAME channel (v1), and only while the platform still has it on;
//   · a fresh provider reference per attempt (`PHI-…-2`), so the callback resolves exactly one row.
// Stock, voucher and flash price were consumed ONCE, by the order; nothing here touches them.
// Conversion tracking is untouched too: the held Purchase is released by whichever payment lands.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Same sentence the order API uses (ADR 0004): the shopper's next step, never the gateway's words. */
const PAY_START_FAILED = "Pembayaran tidak dapat dimulai. Hubungi penjual dengan nomor pesanan ini.";

const NOT_FOUND = "Pesanan tidak ditemukan di perangkat ini. Hubungi penjual dan sebutkan nomor pesanan.";

const REFUSAL_COPY: Record<RetryRefusal | "channel_off", string> = {
  cod: "Pesanan ini dibayar di tempat (COD) — tidak perlu tagihan online.",
  order_closed: "Pesanan ini sudah ditutup atau diproses penjual. Hubungi penjual untuk bantuan.",
  already_paid: "Pembayaran untuk pesanan ini sudah diterima.",
  still_live: "Tagihan sebelumnya masih berlaku.",
  in_progress: "Tagihan baru sedang dibuat. Coba lagi sebentar.",
  unknown_outcome: "Status tagihan sebelumnya belum bisa dipastikan. Hubungi penjual dengan nomor pesanan ini.",
  no_payment: "Pesanan ini belum punya tagihan. Hubungi penjual dengan nomor pesanan ini.",
  order_expired: "Batas waktu pesanan ini sudah lewat. Silakan pesan ulang atau hubungi penjual.",
  attempt_limit: "Tagihan untuk pesanan ini sudah terlalu sering dibuat ulang. Hubungi penjual dengan nomor pesanan ini.",
  channel_off: "Metode pembayaran pesanan ini sudah tidak tersedia. Hubungi penjual dengan nomor pesanan ini.",
};

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: CORS });

type Instruction = {
  orderNumber: string;
  channelCode: string | null;
  virtualAccount: string | null;
  qr: string | null;
  paymentCode: string | null;
  url: string | null;
  amountIdr: number;
  adminFee: number | null;
  total: number | null;
  expiresAt: Date | null;
};

/** The `payment` object /checkout/sukses already renders from the order API — same keys, same meaning. */
async function paymentView(p: Instruction, channel: { code: string; label: string; kind: string }) {
  return {
    channel,
    virtualAccount: p.virtualAccount,
    qr: p.qr,
    qrImage: await qrImageDataUrl(p.qr, p.orderNumber),
    paymentCode: p.paymentCode,
    url: p.url,
    amount: p.amountIdr,
    admin: p.adminFee ?? 0,
    total: p.total && p.total > 0 ? p.total : p.amountIdr,
    expiresAt: p.expiresAt?.toISOString() ?? null,
  };
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("[pay/retry] unhandled:", err);
    return json({ ok: false, error: "Terjadi kesalahan. Coba lagi sebentar." }, 500);
  }
}

async function handle(req: Request) {
  // Tighter than the order API: a shopper presses this once or twice, and each success is a vendor call.
  const limited = rateLimited(req, "pay-retry", 6, 60_000, CORS);
  if (limited) return limited;
  const raw = await readPublicBody(req, CORS);
  if (raw.res) return raw.res;
  let body: { storeSlug?: unknown; orderNumber?: unknown; token?: unknown };
  try {
    body = JSON.parse(raw.text);
  } catch {
    return json({ ok: false, error: "Body tidak valid." }, 400);
  }
  const slug = typeof body.storeSlug === "string" ? body.storeSlug.trim() : "";
  const number = typeof body.orderNumber === "string" ? body.orderNumber.trim() : "";
  if (!slug || !number || number.length > 64) return json({ ok: false, error: NOT_FOUND, code: "not_found" }, 404);

  const [store] = await db
    .select({ id: schema.stores.id })
    .from(schema.stores)
    .where(and(eq(schema.stores.slug, slug), isNull(schema.stores.suspendedAt)))
    .limit(1);
  if (!store) return json({ ok: false, error: NOT_FOUND, code: "not_found" }, 404);

  const now = new Date();
  // ── THE CLAIM — one transaction, under the ORDER's row lock ─────────────────────────────────────
  // Two taps, two tabs, a retry racing the cron: whoever holds the lock decides; the second reader
  // sees the first one's `in_progress` row and is answered "in_progress" instead of minting a second
  // bill. The provider call happens AFTER commit — a network round-trip never holds a transaction.
  const claim = await db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        status: schema.orders.status,
        financialStatus: schema.orders.financialStatus,
        placedAt: schema.orders.placedAt,
        payTokenHash: schema.orders.payTokenHash,
        customerId: schema.orders.customerId,
      })
      .from(schema.orders)
      // Store-scoped: this runs on the OWNER connection (no tenant to set), so the WHERE is the rule.
      .where(and(eq(schema.orders.storeId, store.id), eq(schema.orders.number, number)))
      .for("update")
      .limit(1);
    if (!order || !payTokenMatches(body.token, order.payTokenHash)) return { kind: "not_found" as const };
    // …and the SAME advisory lock the Seller's re-bill (`createOrderPayment`) takes, so a shopper's
    // retry and a seller's "Buat tagihan" on one order are serialised too — not only two retries.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${order.id}::text, 0))`);

    const payments = await tx
      .select({
        id: schema.payments.id,
        status: schema.payments.status,
        method: schema.payments.method,
        channelCode: schema.payments.channelCode,
        amountIdr: schema.payments.amountIdr,
        adminFee: schema.payments.adminFee,
        total: schema.payments.total,
        virtualAccount: schema.payments.virtualAccount,
        qr: schema.payments.qr,
        paymentCode: schema.payments.paymentCode,
        url: schema.payments.url,
        expiresAt: schema.payments.expiresAt,
        requestState: schema.payments.requestState,
        requestUpdatedAt: schema.payments.requestUpdatedAt,
      })
      .from(schema.payments)
      .where(eq(schema.payments.orderId, order.id))
      .orderBy(asc(schema.payments.createdAt), asc(schema.payments.id))
      .for("update");

    const decision = retryDecision(order, payments, now);
    if (!decision.ok) return { kind: "refused" as const, code: decision.code, live: decision.live ?? null, order };

    const from = decision.from;
    // The channel must still be one the PLATFORM has on — the same gate the order API applies (ADR 0004).
    const [channel] = from.channelCode
      ? await tx
          .select({
            code: schema.platformPaymentChannels.channel,
            label: schema.platformPaymentChannels.label,
            kind: schema.platformPaymentChannels.kind,
          })
          .from(schema.platformPaymentChannels)
          .where(
            and(
              eq(schema.platformPaymentChannels.channel, from.channelCode),
              eq(schema.platformPaymentChannels.enabled, true),
              eq(schema.platformPaymentChannels.active, true),
            ),
          )
          .limit(1)
      : [];
    if (!channel) return { kind: "refused" as const, code: "channel_off" as const, live: null, order };

    // Every row still `menunggu` here is DEAD by the decision above (expired, or unknown past its
    // bound). Say so in the row: a Seller screen reading "Menunggu" over a dead QR is a lie. The
    // callback still accepts a late PAID on a `gagal` row — it only refuses to leave `berhasil`.
    await tx
      .update(schema.payments)
      .set({ status: "gagal" })
      .where(and(eq(schema.payments.orderId, order.id), eq(schema.payments.status, "menunggu")));

    const reffId = retryReffId(order.number, payments.length + 1);
    const [inserted] = await tx
      .insert(schema.payments)
      .values({
        orderId: order.id,
        storeId: store.id,
        method: from.method,
        channelCode: from.channelCode,
        // THE SAME MONEY as the bill the shopper agreed to (see the header).
        amountIdr: from.amountIdr,
        adminFee: from.adminFee,
        total: from.total,
        status: "menunggu",
        provider: "autolaris",
        reffId,
        // `payments_store_request_key_unique` makes a duplicate attempt number a DB impossibility,
        // not merely something the row lock happens to prevent.
        requestKey: reffId,
        requestState: "in_progress",
        requestUpdatedAt: now,
      })
      .returning({ id: schema.payments.id });

    const [customer] = order.customerId
      ? await tx
          .select({ name: schema.customers.name, phone: schema.customers.phone, email: schema.customers.email })
          .from(schema.customers)
          .where(and(eq(schema.customers.id, order.customerId), eq(schema.customers.storeId, store.id)))
          .limit(1)
      : [];

    return {
      kind: "owner" as const,
      paymentId: inserted.id,
      reffId,
      order,
      from,
      channel,
      customer: customer ?? null,
    };
  });

  if (claim.kind === "not_found") return json({ ok: false, error: NOT_FOUND, code: "not_found" }, 404);

  if (claim.kind === "refused") {
    // A double tap, or a shopper coming back while the bill is still open: hand back THAT bill.
    if (claim.code === "still_live" && claim.live) {
      const live = claim.live;
      const [ch] = live.channelCode
        ? await db
            .select({
              code: schema.platformPaymentChannels.channel,
              label: schema.platformPaymentChannels.label,
              kind: schema.platformPaymentChannels.kind,
            })
            .from(schema.platformPaymentChannels)
            .where(eq(schema.platformPaymentChannels.channel, live.channelCode))
            .limit(1)
        : [];
      return json({
        ok: true,
        reused: true,
        orderNumber: claim.order.number,
        payment: await paymentView(
          { ...live, orderNumber: claim.order.number },
          ch ?? { code: live.channelCode ?? "", label: live.channelCode ?? "", kind: live.method === "qris" ? "qris" : "va" },
        ),
      });
    }
    return json({ ok: false, code: claim.code, error: REFUSAL_COPY[claim.code] }, 409);
  }

  // ── THE PROVIDER CALL — outside any transaction ──────────────────────────────────────────────────
  const finish = async (set: Partial<typeof schema.payments.$inferInsert>) => {
    await db
      .update(schema.payments)
      .set({ ...set, requestUpdatedAt: new Date() })
      .where(and(eq(schema.payments.id, claim.paymentId), eq(schema.payments.requestState, "in_progress")));
  };
  if (!autolarisConfigured()) {
    await finish({ status: "gagal", requestState: "failed", requestError: "Payment gateway belum dikonfigurasi oleh platform." });
    return json({ ok: false, code: "payment_start_failed", error: PAY_START_FAILED }, 503);
  }
  const amount = claim.from.total && claim.from.total > 0 ? claim.from.total : claim.from.amountIdr;
  let pay: Awaited<ReturnType<typeof alCreateOrder>>;
  try {
    pay = await alCreateOrder({
      reffId: claim.reffId,
      channelCode: claim.channel.code,
      amount,
      customerName: claim.customer?.name ?? "Pelanggan",
      customerPhone: claim.customer?.phone ?? "081200000000",
      customerEmail: claim.customer?.email || "order@tokophi.id",
      // Signed for THIS attempt's reference — the callback binds the signature to `payments.reff_id`.
      callbackUrl: payCallbackUrl(claim.reffId),
      items: [{ name: `Pesanan ${claim.order.number}`, qty: 1, unitPrice: amount }],
    });
  } catch (err) {
    // UNKNOWN outcome: the vendor may hold a live bill under this reference. The row stays `menunggu`
    // with no expiry, which `instructionState` reads as "unknown" — no further bill until it is bounded.
    console.error("[pay/retry] alCreateOrder threw for", claim.reffId, err);
    await finish({ requestState: "failed", requestError: "provider call threw — outcome unknown" });
    return json({ ok: false, code: "payment_start_failed", error: PAY_START_FAILED }, 502);
  }
  if (!pay.ok) {
    // A REFUSAL: nothing was created, so the attempt is simply failed (and another may follow, up to
    // MAX_PAY_ATTEMPTS). The provider's words are kept for the Seller, never shown to the shopper.
    console.error("[pay/retry] gateway refused", claim.reffId, "—", pay.error);
    await finish({ status: "gagal", requestState: "failed", requestError: (pay.error ?? "").slice(0, 500) || null });
    return json({ ok: false, code: "payment_start_failed", error: PAY_START_FAILED }, 502);
  }
  const expiresAt = pay.expiresAt ? new Date(pay.expiresAt) : null;
  if (!expiresAt) console.warn("[pay/retry] provider returned no parseable expiry for", claim.reffId);
  if (pay.total != null && Math.round(pay.total) !== amount) {
    console.warn("[pay/retry] provider grand_total differs from ours", claim.reffId, "ours", amount, "theirs", pay.total);
  }
  await finish({
    requestState: "accepted",
    requestError: null,
    trxId: pay.trxId,
    virtualAccount: pay.virtualAccount,
    qr: pay.qr,
    url: pay.url,
    paymentCode: pay.paymentCode,
    expiresAt,
  });
  return json({
    ok: true,
    orderNumber: claim.order.number,
    payment: await paymentView(
      {
        orderNumber: claim.order.number,
        channelCode: claim.channel.code,
        virtualAccount: pay.virtualAccount ?? null,
        qr: pay.qr ?? null,
        paymentCode: pay.paymentCode ?? null,
        url: pay.url ?? null,
        amountIdr: claim.from.amountIdr,
        adminFee: claim.from.adminFee,
        total: claim.from.total,
        expiresAt,
      },
      claim.channel,
    ),
  });
}
