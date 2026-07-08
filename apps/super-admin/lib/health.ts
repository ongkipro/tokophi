import "server-only";
import { db, schema } from "@tokophi/db";
import { eq, sql } from "drizzle-orm";
import type { HealthCheck, HealthVerdict, StoreHealth } from "./health-types";

// Composite store health for the platform control plane. Everything is derived from real
// DB signals (super-admin reads on the owner connection, cross-tenant): billing (overdue /
// failed invoices), activity (recency of the last order), stock (out-of-stock products), and
// subscription status. No live pings — this is a single-machine local deployment.

const TODAY = new Date("2026-07-02T00:00:00Z"); // matches the seed anchor
const daysSince = (d: Date | null) => (d ? Math.round((TODAY.getTime() - d.getTime()) / 86_400_000) : null);

const OVERDUE_DAYS = 14; // a "menunggu" invoice older than this is treated as nunggak
const ACTIVITY_WARN_DAYS = 14;
const ACTIVITY_FAIL_DAYS = 30;

function verdictOf(checks: HealthCheck[]): { verdict: HealthVerdict; score: number } {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const verdict: HealthVerdict = fails ? "bermasalah" : warns ? "perhatian" : "sehat";
  const score = Math.max(0, Math.min(100, 100 - fails * 40 - warns * 15));
  return { verdict, score };
}

type Signals = {
  status: "active" | "trial" | "suspended";
  invoices: { status: "dibayar" | "menunggu" | "gagal"; issuedAt: Date }[];
  lastOrderAt: Date | null;
  outOfStock: number;
};

function checksFor(sig: Signals): HealthCheck[] {
  const checks: HealthCheck[] = [];

  // billing
  const bad = sig.invoices.filter((i) => i.status === "gagal" || (i.status === "menunggu" && (daysSince(i.issuedAt) ?? 0) > OVERDUE_DAYS));
  checks.push(
    bad.length
      ? { key: "billing", label: "Penagihan", status: "fail", detail: `${bad.length} tagihan bermasalah (gagal/nunggak)` }
      : { key: "billing", label: "Penagihan", status: "ok", detail: "Tidak ada tagihan nunggak" },
  );

  // activity (order recency)
  const last = daysSince(sig.lastOrderAt);
  if (sig.status === "trial") {
    checks.push({ key: "activity", label: "Aktivitas", status: "ok", detail: last == null ? "Trial — belum ada order" : `Order terakhir ${last} hari lalu` });
  } else if (last == null) {
    checks.push({ key: "activity", label: "Aktivitas", status: "fail", detail: "Belum ada order sama sekali" });
  } else if (last > ACTIVITY_FAIL_DAYS) {
    checks.push({ key: "activity", label: "Aktivitas", status: "fail", detail: `Order terakhir ${last} hari lalu` });
  } else if (last > ACTIVITY_WARN_DAYS) {
    checks.push({ key: "activity", label: "Aktivitas", status: "warn", detail: `Order terakhir ${last} hari lalu` });
  } else {
    checks.push({ key: "activity", label: "Aktivitas", status: "ok", detail: `Order terakhir ${last} hari lalu` });
  }

  // stock
  checks.push(
    sig.outOfStock > 0
      ? { key: "stock", label: "Stok", status: "warn", detail: `${sig.outOfStock} produk habis stok` }
      : { key: "stock", label: "Stok", status: "ok", detail: "Stok aman" },
  );

  // subscription status
  if (sig.status === "suspended") checks.push({ key: "status", label: "Langganan", status: "fail", detail: "Toko ditangguhkan" });
  else if (sig.status === "trial") checks.push({ key: "status", label: "Langganan", status: "warn", detail: "Masa trial" });
  else checks.push({ key: "status", label: "Langganan", status: "ok", detail: "Langganan aktif" });

  return checks;
}

export function healthFromSignals(sig: Signals): StoreHealth {
  const checks = checksFor(sig);
  return { ...verdictOf(checks), checks };
}

// One round-trip per signal (grouped), assembled in JS — cheap for the platform's store count.
export async function getHealthMap(): Promise<Map<string, StoreHealth>> {
  const stores = await db.select({ id: schema.stores.id, status: schema.stores.status }).from(schema.stores);

  const invoices = await db
    .select({ storeId: schema.invoices.storeId, status: schema.invoices.status, issuedAt: schema.invoices.issuedAt })
    .from(schema.invoices);
  const invByStore = new Map<string, Signals["invoices"]>();
  for (const i of invoices) {
    if (!i.storeId) continue;
    (invByStore.get(i.storeId) ?? invByStore.set(i.storeId, []).get(i.storeId)!).push({ status: i.status, issuedAt: i.issuedAt });
  }

  const lastOrders = await db
    .select({ storeId: schema.orders.storeId, last: sql<Date>`max(${schema.orders.placedAt})` })
    .from(schema.orders)
    .groupBy(schema.orders.storeId);
  const lastByStore = new Map(lastOrders.map((r) => [r.storeId, r.last ? new Date(r.last) : null]));

  const oos = await db.execute(sql`
    select p.store_id as "storeId", count(*)::int as "cnt"
    from products p
    where p.status = 'active'
      and not exists (
        select 1 from product_variants v
        join inventory_levels il on il.variant_id = v.id
        where v.product_id = p.id and il.available > 0
      )
    group by p.store_id
  `);
  const oosByStore = new Map<string, number>();
  for (const r of oos as unknown as { storeId: string; cnt: number }[]) oosByStore.set(r.storeId, Number(r.cnt));

  const map = new Map<string, StoreHealth>();
  for (const s of stores) {
    map.set(
      s.id,
      healthFromSignals({
        status: s.status,
        invoices: invByStore.get(s.id) ?? [],
        lastOrderAt: lastByStore.get(s.id) ?? null,
        outOfStock: oosByStore.get(s.id) ?? 0,
      }),
    );
  }
  return map;
}

export async function getStoreHealth(storeId: string): Promise<StoreHealth | null> {
  const [s] = await db.select({ id: schema.stores.id, status: schema.stores.status }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return null;
  const invoices = await db
    .select({ status: schema.invoices.status, issuedAt: schema.invoices.issuedAt })
    .from(schema.invoices)
    .where(eq(schema.invoices.storeId, storeId));
  const [lastRow] = await db
    .select({ last: sql<Date>`max(${schema.orders.placedAt})` })
    .from(schema.orders)
    .where(eq(schema.orders.storeId, storeId));
  const oos = await db.execute(sql`
    select count(*)::int as "cnt"
    from products p
    where p.store_id = ${storeId} and p.status = 'active'
      and not exists (
        select 1 from product_variants v
        join inventory_levels il on il.variant_id = v.id
        where v.product_id = p.id and il.available > 0
      )
  `);
  const outOfStock = Number((oos as unknown as { cnt: number }[])[0]?.cnt ?? 0);
  return healthFromSignals({ status: s.status, invoices, lastOrderAt: lastRow?.last ? new Date(lastRow.last) : null, outOfStock });
}
