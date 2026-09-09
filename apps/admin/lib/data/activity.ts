import "server-only";
import { schema } from "@tokophi/db";
import { desc, eq, sql } from "drizzle-orm";
import { withCurrentTenant, type Tx } from "@/lib/tenant";
import type { Activity } from "@/lib/types/domain";

// Real "live activity" feed for the CURRENT store (RLS-scoped): recent orders, signups,
// reviews, and low-stock alerts — replacing the static mock so it reflects the actual store
// (incl. an impersonated one).
//
// ⚠️ THE REAL CLOCK. This was `ANCHOR = 2026-07-02T23:59` — "just past the seed's TODAY so N stays
// >= 0" — which is the `Math.max(0, …)` doing the hiding, not the anchor doing the job: every event
// that actually happened after the seed was written clamped to 0 and read "baru saja", so a feed
// whose entire purpose is recency showed a week-old order and a signup from this minute identically.
// The seed may be anchored; the app is not. (`Math.max(0, …)` stays — a clock skew of a few seconds
// on a row written by another process must not render as a negative age.)
const minsAgo = (d: Date | null) => (d ? Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000)) : 0);

export async function getActivityFeed(limit = 8): Promise<Activity[]> {
  return withCurrentTenant(async (db: Tx) => {
    const items: Activity[] = [];

    // recent orders → "{customer} dari {kota} membuat pesanan baru"
    const orders = await db
      .select({ id: schema.orders.id, city: schema.orders.city, placedAt: schema.orders.placedAt, customer: schema.customers.name })
      .from(schema.orders)
      .leftJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .orderBy(desc(schema.orders.placedAt))
      .limit(3);
    for (const o of orders) {
      const who = o.customer ?? "Pelanggan";
      const where = o.city ? ` dari ${o.city}` : "";
      items.push({ id: `ord-${o.id}`, kind: "order", text: `${who}${where} membuat pesanan baru`, minutesAgo: minsAgo(o.placedAt) });
    }

    // recent signups → "{name} mendaftar sebagai pelanggan baru"
    const custs = await db
      .select({ id: schema.customers.id, name: schema.customers.name, createdAt: schema.customers.createdAt })
      .from(schema.customers)
      .orderBy(desc(schema.customers.createdAt))
      .limit(4);
    for (const c of custs) {
      items.push({ id: `sgn-${c.id}`, kind: "signup", text: `${c.name} mendaftar sebagai pelanggan baru`, minutesAgo: minsAgo(c.createdAt) });
    }

    // recent reviews → "Ulasan N bintang untuk \"{produk}\""
    const revs = await db
      .select({ id: schema.reviews.id, rating: schema.reviews.rating, product: schema.reviews.productName, createdAt: schema.reviews.createdAt })
      .from(schema.reviews)
      .orderBy(desc(schema.reviews.createdAt))
      .limit(4);
    for (const r of revs) {
      if (!r.product) continue;
      items.push({ id: `rev-${r.id}`, kind: "review", text: `Ulasan ${r.rating} bintang untuk "${r.product}"`, minutesAgo: minsAgo(r.createdAt) });
    }

    // low stock (active products, total available <= 5) → "Stok \"{produk}\" tinggal N"
    // no natural timestamp — rank as recent/urgent (lower stock = more recent).
    const low = (await db.execute(sql`
      select p.title as "title", coalesce(sum(il.available), 0)::int as "avail"
      from products p
      join product_variants v on v.product_id = p.id
      join inventory_levels il on il.variant_id = v.id
      where p.status = 'active'
      group by p.id, p.title
      having coalesce(sum(il.available), 0) <= 5
      order by "avail" asc
      limit 4
    `)) as unknown as { title: string; avail: number }[];
    low.forEach((l, i) => {
      items.push({ id: `stk-${i}`, kind: "stock", text: `Stok "${l.title}" tinggal ${l.avail}`, minutesAgo: 20 + l.avail * 15 });
    });

    return items.sort((a, b) => a.minutesAgo - b.minutesAgo).slice(0, limit);
  });
}
