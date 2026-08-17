"use server";

import { schema } from "@tokophi/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  alCreatePayment,
  autolarisConfigured,
  type AlPayment,
} from "@tokophi/lib/autolaris";
import { payCallbackUrl } from "@tokophi/lib/pay-callback";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export type CreateOrderPaymentResult =
  | { ok: true; paymentId: string }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "order_terminal"
        | "already_paid"
        | "active_payment"
        | "idempotency_conflict"
        | "in_progress"
        | "request_failed";
      error: string;
      paymentId?: string;
      terminal?: true;
    };

type StoredRequest = {
  id: string;
  orderId: string;
  amountIdr: number;
  channelCode: string | null;
  requestState: "in_progress" | "accepted" | "failed" | null;
  requestError: string | null;
};

function storedResult(
  payment: StoredRequest,
): CreateOrderPaymentResult | null {
  if (payment.requestState === "accepted") {
    return { ok: true, paymentId: payment.id };
  }
  if (payment.requestState === "failed") {
    return {
      ok: false,
      code: "request_failed",
      error: payment.requestError ?? "Gagal membuat tagihan.",
      paymentId: payment.id,
      terminal: true,
    };
  }
  return null;
}

function intentMatches(
  payment: StoredRequest,
  orderId: string,
  channelCode: string,
  amountIdr: number,
) {
  return (
    payment.orderId === orderId &&
    payment.channelCode === channelCode &&
    payment.amountIdr === amountIdr
  );
}

async function loadStoredRequest(storeId: string, requestKey: string) {
  return withTenant(storeId, async (db) => {
    const [payment] = await db
      .select({
        id: schema.payments.id,
        orderId: schema.payments.orderId,
        amountIdr: schema.payments.amountIdr,
        channelCode: schema.payments.channelCode,
        requestState: schema.payments.requestState,
        requestError: schema.payments.requestError,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.storeId, storeId),
          eq(schema.payments.requestKey, requestKey),
        ),
      )
      .limit(1);
    return payment ?? null;
  });
}

async function awaitStoredResult(
  storeId: string,
  requestKey: string,
  paymentId: string,
): Promise<CreateOrderPaymentResult> {
  // A competing caller never assumes that an in-progress claim was accepted. It waits a bounded,
  // fixed interval for the owner to persist the terminal request result, then reports the still-live
  // identity honestly so the caller can retry the SAME key.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    const payment = await loadStoredRequest(storeId, requestKey);
    if (!payment) {
      throw new Error(`Payment request ${paymentId} disappeared while in progress`);
    }
    const result = storedResult(payment);
    if (result) return result;
  }
  return {
    ok: false,
    code: "in_progress",
    error: "Tagihan masih diproses. Coba lagi dengan permintaan yang sama.",
    paymentId,
  };
}

async function finishFailedRequest(
  storeId: string,
  paymentId: string,
  error: string,
): Promise<CreateOrderPaymentResult> {
  await withTenant(storeId, async (db) => {
    const [updated] = await db
      .update(schema.payments)
      .set({
        status: "gagal",
        requestState: "failed",
        requestError: error,
        requestUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.payments.id, paymentId),
          eq(schema.payments.storeId, storeId),
          eq(schema.payments.requestState, "in_progress"),
        ),
      )
      .returning({ id: schema.payments.id });
    if (!updated) {
      throw new Error(`Payment request ${paymentId} could not be marked failed`);
    }
  });
  return {
    ok: false,
    code: "request_failed",
    error,
    paymentId,
    terminal: true,
  };
}

// Merchant creates a real payment bill (VA/QRIS/DANA) for one of its orders. The caller owns
// `requestKey`: retries for one create-bill intent MUST reuse it, while a deliberate new intent after
// a terminal failure uses a new key.
export async function createOrderPayment(
  orderNumber: string,
  channelCode: string,
  requestKey: string,
): Promise<CreateOrderPaymentResult> {
  const { storeId } = await requireCapability("orders:write");
  if (
    typeof requestKey !== "string" ||
    requestKey.length < 16 ||
    requestKey.length > 128 ||
    requestKey !== requestKey.trim() ||
    !/^[A-Za-z0-9._:-]+$/.test(requestKey)
  ) {
    return {
      ok: false,
      code: "invalid_request",
      error: "Identitas permintaan tagihan tidak valid.",
    };
  }

  const claim = await withTenant(storeId, async (db) => {
    const [order] = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        total: schema.orders.totalIdr,
        status: schema.orders.status,
        financialStatus: schema.orders.financialStatus,
        name: schema.customers.name,
        phone: schema.customers.phone,
        email: schema.customers.email,
      })
      .from(schema.orders)
      .leftJoin(
        schema.customers,
        eq(schema.customers.id, schema.orders.customerId),
      )
      .where(
        and(
          eq(schema.orders.storeId, storeId),
          eq(schema.orders.number, orderNumber),
        ),
      )
      .limit(1);
    if (!order) {
      return {
        kind: "result" as const,
        result: {
          ok: false,
          code: "not_found",
          error: "Pesanan tidak ditemukan.",
        } satisfies CreateOrderPaymentResult,
      };
    }

    // Serialize only the local claim for this order. The lock is transaction-scoped and released
    // before the provider request, so remote I/O never occupies a database transaction.
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${order.id}::text, 0))`,
    );

    const selectStored = async () => {
      const [payment] = await db
        .select({
          id: schema.payments.id,
          orderId: schema.payments.orderId,
          amountIdr: schema.payments.amountIdr,
          channelCode: schema.payments.channelCode,
          requestState: schema.payments.requestState,
          requestError: schema.payments.requestError,
        })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.storeId, storeId),
            eq(schema.payments.requestKey, requestKey),
          ),
        )
        .limit(1);
      return payment ?? null;
    };

    const existing = await selectStored();
    if (existing) {
      if (
        !intentMatches(existing, order.id, channelCode, order.total)
      ) {
        return {
          kind: "result" as const,
          result: {
            ok: false,
            code: "idempotency_conflict",
            error:
              "Identitas permintaan ini sudah dipakai untuk tagihan yang berbeda.",
          } satisfies CreateOrderPaymentResult,
        };
      }
      return { kind: "stored" as const, payment: existing };
    }

    // A replay is resolved above before current order state is checked: once a request was accepted,
    // it must keep replaying that stable local identity even if a later callback marks the order paid.
    if (order.status === "batal" || order.status === "retur") {
      return {
        kind: "result" as const,
        result: {
          ok: false,
          code: "order_terminal",
          error: `Pesanan ${order.number} sudah ${order.status} — tagihan baru tidak bisa dibuat.`,
        } satisfies CreateOrderPaymentResult,
      };
    }
    if (order.financialStatus === "dibayar") {
      return {
        kind: "result" as const,
        result: {
          ok: false,
          code: "already_paid",
          error: `Pesanan ${order.number} sudah dibayar.`,
        } satisfies CreateOrderPaymentResult,
      };
    }

    const [live] = await db
      .select({ status: schema.payments.status })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.orderId, order.id),
          inArray(schema.payments.status, ["menunggu", "berhasil"]),
        ),
      )
      .limit(1);
    if (live) {
      return {
        kind: "result" as const,
        result: {
          ok: false,
          code: live.status === "berhasil" ? "already_paid" : "active_payment",
          error:
            live.status === "berhasil"
              ? "Pesanan ini sudah dibayar."
              : "Sudah ada tagihan aktif untuk pesanan ini.",
        } satisfies CreateOrderPaymentResult,
      };
    }

    const [inserted] = await db
      .insert(schema.payments)
      .values({
        orderId: order.id,
        storeId,
        method:
          channelCode === "QRIS"
            ? "qris"
            : channelCode === "DANA"
              ? "dana"
              : "va",
        amountIdr: order.total,
        status: "menunggu",
        provider: "autolaris",
        // AutoLaris' reff_id is the same caller-stable identity, not the order number. Its callback
        // still resolves this exact persisted value, while a retry cannot mint a second remote intent.
        reffId: requestKey,
        channelCode,
        requestKey,
        requestState: "in_progress",
        requestUpdatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: schema.payments.id });

    if (!inserted) {
      // The only expected conflict is the store-scoped request key. This path matters when the same
      // key is raced across different order ids, whose advisory locks are intentionally independent.
      const winner = await selectStored();
      if (!winner) {
        throw new Error("Payment claim conflicted without a stored request");
      }
      if (!intentMatches(winner, order.id, channelCode, order.total)) {
        return {
          kind: "result" as const,
          result: {
            ok: false,
            code: "idempotency_conflict",
            error:
              "Identitas permintaan ini sudah dipakai untuk tagihan yang berbeda.",
          } satisfies CreateOrderPaymentResult,
        };
      }
      return { kind: "stored" as const, payment: winner };
    }

    return {
      kind: "owner" as const,
      paymentId: inserted.id,
      order,
    };
  });

  if (claim.kind === "result") return claim.result;
  if (claim.kind === "stored") {
    const result = storedResult(claim.payment);
    return (
      result ??
      awaitStoredResult(
        storeId,
        requestKey,
        claim.payment.id,
      )
    );
  }

  if (!autolarisConfigured()) {
    return finishFailedRequest(
      storeId,
      claim.paymentId,
      "Payment gateway belum dikonfigurasi oleh platform.",
    );
  }

  let providerResult: AlPayment;
  try {
    providerResult = await alCreatePayment({
      reffId: requestKey,
      channelCode,
      amount: claim.order.total,
      customerId: claim.order.id,
      customerName: claim.order.name ?? "Pelanggan",
      customerPhone: claim.order.phone ?? "081200000000",
      customerEmail: claim.order.email ?? "order@tokophi.id",
      callbackUrl: payCallbackUrl(),
    });
  } catch {
    return finishFailedRequest(
      storeId,
      claim.paymentId,
      "Gagal menghubungi payment gateway.",
    );
  }

  if (!providerResult.ok) {
    return finishFailedRequest(
      storeId,
      claim.paymentId,
      providerResult.error ?? "Gagal membuat tagihan.",
    );
  }

  await withTenant(storeId, async (db) => {
    const [updated] = await db
      .update(schema.payments)
      .set({
        requestState: "accepted",
        requestError: null,
        requestUpdatedAt: new Date(),
        trxId: providerResult.trxId,
        adminFee: providerResult.admin ?? 0,
        total: providerResult.total ?? claim.order.total,
        virtualAccount: providerResult.virtualAccount,
        qr: providerResult.qr,
        url: providerResult.url,
        paymentCode: providerResult.paymentCode,
      })
      .where(
        and(
          eq(schema.payments.id, claim.paymentId),
          eq(schema.payments.storeId, storeId),
          eq(schema.payments.requestState, "in_progress"),
        ),
      )
      .returning({ id: schema.payments.id });
    if (!updated) {
      throw new Error(
        `Payment request ${claim.paymentId} could not be marked accepted`,
      );
    }
  });

  revalidatePath(`/pesanan/${orderNumber}`);
  return { ok: true, paymentId: claim.paymentId };
}
