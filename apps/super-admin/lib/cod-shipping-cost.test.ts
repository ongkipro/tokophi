import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

// ADR 0014 — the platform ABSORBS the courier's shipping cost on COD orders. The merchant is
// credited the gross order total including ongkir; the courier remits net; we cover the gap.
//
// Absorbing a cost is not the same as ignoring it, and this suite guards the difference. The figure
// on /analitik is the only place that cost is visible, so the ways it could quietly lie are the
// whole point:
//
//   · NULL means NOT RECORDED, never zero. `orders.ka_shipping_cost_idr` arrived with 0088, so every
//     older booking is NULL. Coalescing those to 0 reports a small, confident, wrong number — and it
//     is smallest exactly where the history is longest.
//   · COD and prepaid must stay SEPARATE. Only COD is decided by ADR 0014; prepaid runs the same
//     shape and is explicitly undecided. One combined figure would imply a decision nobody made.
//   · Only DELIVERED orders count. A cancelled or returned booking did not necessarily cost a full
//     carry, and claiming it did overstates the very number this exists to keep honest.
//
// Runs against the throwaway `*_test` DB (test/db-setup.ts), inside a transaction that is ALWAYS
// rolled back — same discipline as ledger-credit.test.ts. It never touches the shared dev database.

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(() => {
  if (!URL) return;
  // `data.ts` imports { db, schema } from @tokophi/db as VALUES, so the module initialises the shared
  // client at import time and throws when DATABASE_URL is unset (db-setup exports only
  // TEST_DATABASE_URL). Point it at the SAME throwaway database: every query below is handed an
  // explicit `tx`, so that client is never used to run anything — this only satisfies the import.
  process.env.DATABASE_URL ||= URL;
  client = postgres(URL, { max: 1 });
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  await client?.end();
});

/** One store + one order + its payment, with an explicit courier cost (or NULL for "not recorded"). */
async function seedOrder(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  storeId: string,
  o: { number: string; status: string; method: string | null; cost: number | null; booked?: boolean },
) {
  await tx.execute(sql`
    insert into orders (store_id, number, status, subtotal_idr, shipping_idr, total_idr,
                        ka_order_id, ka_shipping_cost_idr)
    values (${storeId}, ${o.number}, ${o.status}::order_status, 100000, 20000, 120000,
            ${o.booked === false ? null : "KA-" + o.number}, ${o.cost})
  `);
  if (o.method) {
    await tx.execute(sql`
      insert into payments (order_id, store_id, method, status, amount_idr)
      select id, ${storeId}, ${o.method}::payment_method, 'berhasil', 120000
        from orders where number = ${o.number}
    `);
  }
}

suite("getCourierCostAbsorbed — the cost we absorb, reported honestly (ADR 0014)", () => {
  it("separates COD from prepaid, and never treats an unrecorded cost as zero", async () => {
    const { getCourierCostAbsorbed } = await import("./data");
    await expect(
      db.transaction(async (tx) => {
        const [acc] = (await tx.execute(sql`
          insert into accounts (name) values ('Cost Guard Acc') returning id
        `)) as unknown as { id: string }[];
        const [store] = (await tx.execute(sql`
          insert into stores (account_id, name, slug)
          values (${acc.id}, 'Cost Guard', ${"cost-guard-" + Date.now()})
          returning id
        `)) as unknown as { id: string }[];
        const s = store.id;

        await seedOrder(tx, s, { number: "CG-COD-1", status: "selesai", method: "cod", cost: 17000 });
        await seedOrder(tx, s, { number: "CG-COD-2", status: "selesai", method: "cod", cost: 23000 });
        // Prepaid — same mechanics, deliberately NOT folded into the COD figure.
        await seedOrder(tx, s, { number: "CG-VA-1", status: "selesai", method: "va", cost: 11000 });
        // Booked before 0088: cost UNKNOWN. Must be counted, not summed as nil.
        await seedOrder(tx, s, { number: "CG-OLD", status: "selesai", method: "cod", cost: null });
        // Not delivered — must not be counted at all.
        await seedOrder(tx, s, { number: "CG-RETUR", status: "retur", method: "cod", cost: 99000 });
        await seedOrder(tx, s, { number: "CG-KIRIM", status: "dikirim", method: "cod", cost: 88000 });
        // Never booked with a courier — no carry, no cost.
        await seedOrder(tx, s, { number: "CG-NOBOOK", status: "selesai", method: "cod", cost: null, booked: false });

        const r = await getCourierCostAbsorbed(tx as unknown as Parameters<typeof getCourierCostAbsorbed>[0]);

        // 17.000 + 23.000 — the returned/shipped/unbooked rows contribute nothing.
        expect(r.codIdr).toBe(40000);
        expect(r.codOrders).toBe(2);
        // Prepaid stands alone. If this ever equals codIdr + 11000, the two flows have been merged.
        expect(r.prepaidIdr).toBe(11000);
        expect(r.prepaidOrders).toBe(1);
        // CG-OLD (booked, delivered, cost NULL). CG-NOBOOK is excluded — it was never booked.
        expect(r.unrecordedOrders).toBe(1);

        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
  });

  it("reports zero — with nothing unrecorded — when no parcel was ever booked", async () => {
    const { getCourierCostAbsorbed } = await import("./data");
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`delete from payments`);
        await tx.execute(sql`delete from orders`);
        const r = await getCourierCostAbsorbed(tx as unknown as Parameters<typeof getCourierCostAbsorbed>[0]);
        expect(r).toEqual({ codIdr: 0, codOrders: 0, prepaidIdr: 0, prepaidOrders: 0, unrecordedOrders: 0 });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
  });
});
