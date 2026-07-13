"use server";
import { schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import { settleOrderLedger } from "@/lib/ledger-credit";

export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal" | "retur";

export async function setOrderStatus(orderId: string, status: OrderStatus, returnReason?: string): Promise<void> {
  const { storeId: sid } = await requireCapability("orders:write");
  const number = orderId.replace(/^#/, ""); // order.id is "#INV-4819"
  await withTenant(sid, async (db) => {
    const [order] = await db
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.number, number))
      .limit(1);
    if (!order) return;

    // Cancelling OR returning a live order → put the stock back. `batal` never shipped; `retur`
    // shipped and came back — but in BOTH cases the goods are on the merchant's shelf again, so
    // both must restore inventory. Missing the `retur` case would quietly shrink real stock on
    // every refused COD parcel. Guarded on the previous status so a repeat click can't
    // double-restore.
    const restores = status === "batal" || status === "retur";
    if (restores && order.status !== status) {
      const lines = await db
        .select({ variantId: schema.orderLineItems.variantId, qty: schema.orderLineItems.qty })
        .from(schema.orderLineItems)
        .where(eq(schema.orderLineItems.orderId, order.id));
      for (const l of lines) {
        if (!l.variantId) continue;
        await db
          .update(schema.inventoryLevels)
          .set({ available: sql`${schema.inventoryLevels.available} + ${l.qty}` })
          .where(eq(schema.inventoryLevels.variantId, l.variantId));
      }

      // fail any still-pending payment so a cancelled/returned order can't be marked paid later.
      // For a refused COD parcel this is the whole point: the cash was never collected.
      await db
        .update(schema.payments)
        .set({ status: "gagal" })
        .where(and(eq(schema.payments.orderId, order.id), eq(schema.payments.status, "menunggu")));
    }

    await db
      .update(schema.orders)
      .set(
        status === "retur"
          ? { status, returnedAt: new Date(), returnReason: returnReason?.trim() || "Pembeli menolak paket" }
          : { status },
      )
      .where(eq(schema.orders.id, order.id));

    // ── Saldo (ledger, migrations 0040 + 0041) ────────────────────────────────
    // The order's money moves with its status — booked/released/clawed back in `settleOrderLedger`,
    // inside THIS transaction, so the book can never disagree with the order it describes.
    await settleOrderLedger(db, { storeId: sid, orderId: order.id, status, prevStatus: order.status });
  });
  revalidatePath("/pesanan");
  revalidatePath(`/pesanan/${number}`);
}
