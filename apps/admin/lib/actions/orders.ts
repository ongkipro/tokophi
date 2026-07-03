"use server";
import { db, schema } from "@indostore/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "batal";

export async function setOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const number = orderId.replace(/^#/, ""); // order.id is "#INV-4819"
  await db.update(schema.orders).set({ status }).where(eq(schema.orders.number, number));
  revalidatePath("/pesanan");
  revalidatePath(`/pesanan/${number}`);
}
