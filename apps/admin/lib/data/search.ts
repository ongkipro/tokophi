import "server-only";
import { schema } from "@tokophi/db";
import { desc, eq, ne } from "drizzle-orm";
import { withCurrentTenant, type Tx } from "@/lib/tenant";

// Lightweight global-search index for the topbar (⌘K): products, recent orders, customers.
// RLS-scoped to the current store. Kept lean (id + label + sub + href) for client filtering.
export type SearchItem = {
  id: string;
  label: string;
  sub: string;
  href: string;
  type: "produk" | "pesanan" | "pelanggan";
};

export async function getSearchIndex(): Promise<SearchItem[]> {
  return withCurrentTenant(async (db: Tx) => {
    const products = await db
      .select({ id: schema.products.id, title: schema.products.title, category: schema.products.category })
      .from(schema.products)
      .where(ne(schema.products.status, "archived"));
    const orders = await db
      .select({ number: schema.orders.number, customer: schema.customers.name, city: schema.orders.city })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .orderBy(desc(schema.orders.placedAt))
      .limit(80);
    const customers = await db
      .select({ id: schema.customers.id, name: schema.customers.name, email: schema.customers.email })
      .from(schema.customers);

    return [
      ...products.map((p): SearchItem => ({ id: p.id, label: p.title, sub: p.category ?? "Produk", href: `/produk/${p.id}`, type: "produk" })),
      ...orders.map((o): SearchItem => ({ id: o.number, label: o.number, sub: o.customer ?? o.city ?? "Pesanan", href: `/pesanan/${o.number.replace("#", "")}`, type: "pesanan" })),
      ...customers.map((c): SearchItem => ({ id: c.id, label: c.name, sub: c.email ?? "", href: `/pelanggan/${c.id}`, type: "pelanggan" })),
    ];
  });
}
