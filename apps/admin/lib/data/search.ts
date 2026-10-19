import "server-only";
import { schema } from "@tokophi/db";
import { desc, eq, ne, sql } from "drizzle-orm";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import type { SearchItem } from "@/lib/search-model";

export type { SearchItem } from "@/lib/search-model";

// Lightweight global-search index for the topbar (⌘K): products, recent orders, customers.
// RLS-scoped to the current store. Kept lean (id + label + sub + href + a few display details) for
// client filtering — it rides on every admin page render, so nothing here may be a per-row subquery.
//
// Display details are only ones the tables really hold: an order's status and total, a product's
// "from" price (min variant) and whether it is a draft, a customer's order count. Phone numbers are
// SEARCHABLE (`keywords`) but never displayed in the palette.

/** The phone as a seller types it: canonical `62…` and the local `0…` form. Digits only. */
export function phoneKeywords(phone: string | null): string | undefined {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 6) return undefined;
  return d.startsWith("62") ? `${d} 0${d.slice(2)}` : d;
}

/** The query itself, taking a tenant-scoped transaction — exported so the RLS test can run the REAL thing. */
export async function loadSearchIndex(db: Tx): Promise<SearchItem[]> {
  const products = await db
    .select({ id: schema.products.id, number: schema.products.number, title: schema.products.title, category: schema.products.category, status: schema.products.status })
    .from(schema.products)
    .where(ne(schema.products.status, "archived"));
  // ONE grouped read for every product's "from" price. `product_variants` carries its own store_id and
  // RLS policy, so under the tenant role this only ever sees this store's variants.
  const prices = await db
    .select({ productId: schema.productVariants.productId, price: sql<number>`coalesce(min(${schema.productVariants.priceIdr}), 0)`.mapWith(Number) })
    .from(schema.productVariants)
    .groupBy(schema.productVariants.productId);
  const priceOf = new Map(prices.map((p) => [p.productId, p.price]));
  const orders = await db
    .select({ number: schema.orders.number, customer: schema.customers.name, city: schema.orders.city, status: schema.orders.status, total: schema.orders.totalIdr })
    .from(schema.orders)
    .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .orderBy(desc(schema.orders.placedAt))
    .limit(80);
  const customers = await db
    .select({ id: schema.customers.id, name: schema.customers.name, email: schema.customers.email, phone: schema.customers.phone, ordersCount: schema.customers.ordersCount })
    .from(schema.customers);

  return [
    // `#1042` in the SUBTITLE, not just the href: it makes the catalog number searchable, which is
    // the whole point of having one — a merchant reads it in a Merchant Center disapproval and needs
    // to find the product from that number alone. The palette filters on label + sub.
    ...products.map(
      (p): SearchItem => ({
        id: p.id,
        label: p.title,
        sub: `#${p.number} · ${p.category ?? "Produk"}`,
        href: `/produk/${p.number}`,
        type: "produk",
        meta: { kind: "produk", priceIdr: priceOf.get(p.id) ?? 0, draft: p.status === "draft" },
      }),
    ),
    ...orders.map(
      (o): SearchItem => ({
        id: o.number,
        label: o.number,
        sub: o.customer ?? o.city ?? "Pesanan",
        href: `/pesanan/${o.number.replace("#", "")}`,
        type: "pesanan",
        meta: { kind: "pesanan", status: o.status, totalIdr: Number(o.total ?? 0) },
      }),
    ),
    ...customers.map(
      (c): SearchItem => ({
        id: c.id,
        label: c.name,
        sub: c.email ?? "",
        href: `/pelanggan/${c.id}`,
        type: "pelanggan",
        keywords: phoneKeywords(c.phone),
        meta: { kind: "pelanggan", ordersCount: c.ordersCount },
      }),
    ),
  ];
}

export async function getSearchIndex(): Promise<SearchItem[]> {
  return withCurrentTenant((db: Tx) => loadSearchIndex(db));
}
