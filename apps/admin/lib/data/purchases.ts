import "server-only";
import { db, schema } from "@indostore/db";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { PurchaseOrder } from "@/lib/mock/store";

const ADMIN_TODAY = new Date("2026-06-30T00:00:00Z");

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  const rows = await db
    .select({
      code: schema.purchaseOrders.code,
      supplier: schema.suppliers.name,
      status: schema.purchaseOrders.status,
      total: schema.purchaseOrders.totalIdr,
      etaDate: schema.purchaseOrders.etaDate,
      createdAt: schema.purchaseOrders.createdAt,
      items: sql<number>`count(${schema.purchaseOrderItems.id})`.mapWith(Number),
    })
    .from(schema.purchaseOrders)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.purchaseOrders.supplierId))
    .leftJoin(schema.purchaseOrderItems, eq(schema.purchaseOrderItems.purchaseOrderId, schema.purchaseOrders.id))
    .groupBy(schema.purchaseOrders.id, schema.suppliers.name)
    .orderBy(desc(schema.purchaseOrders.createdAt));
  return rows.map((r) => ({
    id: r.code,
    supplier: r.supplier ?? "—",
    status: r.status,
    items: r.items,
    total: r.total,
    etaDays: r.etaDate ? Math.round((Date.parse(r.etaDate) - ADMIN_TODAY.getTime()) / 86_400_000) : 0,
    createdDaysAgo: Math.round((ADMIN_TODAY.getTime() - r.createdAt.getTime()) / 86_400_000),
  }));
}

// Products (default variant) available to add to a purchase order.
export type POProduct = { variantId: string; name: string; price: number };
export async function getPurchaseProducts(): Promise<POProduct[]> {
  const rows = await db
    .select({ variantId: schema.productVariants.id, name: schema.products.title, price: schema.productVariants.priceIdr })
    .from(schema.products)
    .innerJoin(schema.productVariants, and(eq(schema.productVariants.productId, schema.products.id), eq(schema.productVariants.position, 0)))
    .where(ne(schema.products.status, "archived"))
    .orderBy(asc(schema.products.title));
  return rows;
}
