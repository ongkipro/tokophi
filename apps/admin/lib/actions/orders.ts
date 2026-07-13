"use server";
import { schema } from "@tokophi/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

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

    // ── Saldo (ledger, migration 0040) ────────────────────────────────────────
    // The order's money moves with its status, and it moves HERE — inside the same transaction as
    // the status change, so the book can never disagree with the order it describes.
    //
    // RELEASE on `selesai`, not on `dikirim`: a parcel can only be RETURNED after it shipped, so
    // releasing at despatch would let a merchant withdraw money for goods that come back. For COD
    // the cash does not even exist at despatch — the courier collects at the door.
    if (status === "selesai") {
      await db.execute(sql`
        update ledger_entries
           set status = 'available', available_at = now()
         where order_id = ${order.id} and kind = 'sale' and status = 'pending'
      `);
    }

    // A return claws the credit back. Written as an OPPOSING entry, never by editing the sale:
    // the book stays append-only, so it can always be replayed and audited. The partial unique
    // index (ledger_one_retur_per_order) makes a double-click physically unable to double-refund —
    // the guarantee lives in the DB, not in the hope that the UI behaves.
    if (status === "retur" && order.status !== "retur") {
      await db.execute(sql`
        insert into ledger_entries (store_id, order_id, kind, status, amount_idr, note, available_at)
        select ${sid}, ${order.id}, 'retur', 'available', -l.amount_idr,
               'Retur ' || o.number, now()
          from ledger_entries l
          join orders o on o.id = l.order_id
         where l.order_id = ${order.id} and l.kind = 'sale'
        on conflict do nothing
      `);
    }
  });
  revalidatePath("/pesanan");
  revalidatePath(`/pesanan/${number}`);
}
