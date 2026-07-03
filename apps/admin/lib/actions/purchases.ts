"use server";
import { db, schema } from "@indostore/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";

function revalidate() {
  revalidatePath("/produk/pembelian");
  revalidatePath("/produk/inventori");
  revalidatePath("/produk");
}

export type POLine = { variantId: string; qty: number; cost: number };

export async function createPurchaseOrder(input: {
  supplier: string;
  etaDate?: string;
  note?: string;
  lines: POLine[];
}): Promise<string> {
  const { storeId: sid } = await requireCapability("purchases:write");
  const lines = input.lines.filter((l) => l.variantId && l.qty > 0);
  if (!lines.length) throw new Error("no lines");
  // match supplier by name (case-insensitive); nullable if not found
  const sups = await db.select({ id: schema.suppliers.id, name: schema.suppliers.name }).from(schema.suppliers).where(eq(schema.suppliers.storeId, sid));
  const supplierId = sups.find((s) => s.name.toLowerCase() === input.supplier.trim().toLowerCase())?.id ?? null;
  const total = lines.reduce((a, l) => a + l.qty * l.cost, 0);
  const code = `PO-${Date.now().toString().slice(-6)}`;
  const [po] = await db
    .insert(schema.purchaseOrders)
    .values({ storeId: sid, supplierId, code, status: "dipesan", totalIdr: total, etaDate: input.etaDate || null, note: input.note || null })
    .returning();
  await db.insert(schema.purchaseOrderItems).values(
    lines.map((l) => ({ purchaseOrderId: po.id, variantId: l.variantId, qty: l.qty, costIdr: l.cost, receivedQty: 0 })),
  );
  revalidate();
  return code;
}

// Receive the goods: bump inventory by the outstanding qty of each line, mark received.
export async function receivePurchaseOrder(code: string): Promise<void> {
  await requireCapability("purchases:write");
  const [po] = await db.select({ id: schema.purchaseOrders.id, status: schema.purchaseOrders.status }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.code, code)).limit(1);
  if (!po || po.status === "diterima") return;
  const items = await db.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id));
  for (const it of items) {
    const add = it.qty - it.receivedQty;
    if (it.variantId && add > 0) {
      const [inv] = await db.select().from(schema.inventoryLevels).where(eq(schema.inventoryLevels.variantId, it.variantId)).limit(1);
      if (inv) await db.update(schema.inventoryLevels).set({ available: inv.available + add }).where(eq(schema.inventoryLevels.id, inv.id));
    }
    await db.update(schema.purchaseOrderItems).set({ receivedQty: it.qty }).where(eq(schema.purchaseOrderItems.id, it.id));
  }
  await db.update(schema.purchaseOrders).set({ status: "diterima" }).where(eq(schema.purchaseOrders.id, po.id));
  revalidate();
}

export async function cancelPurchaseOrder(code: string): Promise<void> {
  await requireCapability("purchases:write");
  const [po] = await db.select({ id: schema.purchaseOrders.id }).from(schema.purchaseOrders).where(and(eq(schema.purchaseOrders.code, code))).limit(1);
  if (!po) return;
  await db.delete(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, po.id));
  await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po.id));
  revalidate();
}
