"use server";
import { schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";

export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal";

export async function setOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const { storeId: sid } = await requireCapability("orders:write");
  const number = orderId.replace(/^#/, ""); // order.id is "#INV-4819"
  await withTenant(sid, (db) => db.update(schema.orders).set({ status }).where(eq(schema.orders.number, number)));
  revalidatePath("/pesanan");
  revalidatePath(`/pesanan/${number}`);
}
