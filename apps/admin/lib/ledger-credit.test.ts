import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { creditSaleForPayment, collectCodOnDelivery, settleOrderLedger, type Db } from "./ledger-credit";
// `order-status.ts` imports { schema } from @tokophi/db as a VALUE, which initialises the DB client at
// import time and THROWS if DATABASE_URL is unset. (ledger-credit's rootDb import is type-only, so
// esbuild elides it — that is why the suites above need only TEST_DATABASE_URL.) So we dynamic-import
// it inside the suite's beforeAll, which runs only when the suite is NOT skipped, after pointing
// DATABASE_URL at the same throwaway DB. Keeps plain `vitest run` (no TEST_DATABASE_URL) crash-free.
let applyOrderStatusChange: (typeof import("./order-status"))["applyOrderStatusChange"];

// The ledger — the DB-COUPLED half of the money tests. These exercise the real SQL against a real
// Postgres, because the bugs this file guards against live BELOW the type system: `select sum(…) for
// update` (which Postgres rejects outright, so every withdrawal threw) and the "double-credit is a DB
// impossibility" claim — a claim ABOUT the database, only provable by asking the database.
//
// ISOLATION: every test runs inside a transaction that is ALWAYS rolled back, so nothing is committed
// and the run cannot pollute anything. It needs an isolated DB — set TEST_DATABASE_URL to a throwaway
// database (NEVER the shared dev DB — see CLAUDE.md). Without it, the suite SKIPS rather than fails, so
// `vitest run` stays green on a machine with no test DB.
//
//   docker exec <db> psql -U tokophi -d postgres -c 'CREATE DATABASE tokophi_test'
//   DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test npx drizzle-kit migrate # in packages/db
//   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test npx vitest run apps/admin/lib/ledger-credit.test.ts

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: Db;

beforeAll(() => {
  if (!URL) return;
  client = postgres(URL, { max: 1 });
  // Must match @tokophi/db's client (drizzle(client, { casing: "snake_case" })) — otherwise the query
  // builder in applyOrderStatusChange emits "variantId" instead of "variant_id".
  db = drizzle(client, { casing: "snake_case" }) as unknown as Db;
});
afterAll(async () => {
  await client?.end();
});

// Run fn inside a transaction and ALWAYS roll back. Every test is thereby fully isolated: it can seed
// its own store/order/payment and assert, and none of it survives. The tx satisfies the ledger
// functions' `Db` param (they only call `.execute`).
const ROLLBACK = Symbol("rollback");
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

// Unique-ish suffixes for the UNIQUE columns (stores.slug, orders.number). Deterministic counter — no
// Math.random(); everything rolls back, so values never need to be unique across tests, only within one.
let seq = 0;
const rows = async (tx: Db, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Record<string, unknown>[];

async function mkStore(tx: Db): Promise<string> {
  const a = await rows(tx, sql`insert into accounts (name) values ('Test Acc') returning id`);
  const s = await rows(tx, sql`insert into stores (account_id, name, slug) values (${a[0].id}, 'Test Store', ${"t-" + ++seq}) returning id`);
  return s[0].id as string;
}
async function mkOrder(tx: Db, storeId: string, status = "baru"): Promise<string> {
  const o = await rows(tx, sql`insert into orders (store_id, number, status) values (${storeId}, ${"T-" + ++seq}, ${status}::order_status) returning id`);
  return o[0].id as string;
}
async function mkPayment(
  tx: Db,
  a: { orderId: string; storeId: string; method?: string; amount?: number; total?: number; status?: string },
): Promise<string> {
  const p = await rows(
    tx,
    sql`insert into payments (order_id, store_id, method, amount_idr, total, status)
        values (${a.orderId}, ${a.storeId}, ${a.method ?? "va"}::payment_method, ${a.amount ?? 100_000},
                ${a.total ?? a.amount ?? 100_000}, ${a.status ?? "menunggu"}::payment_status) returning id`,
  );
  return p[0].id as string;
}
const ledgerOf = (tx: Db, orderId: string) =>
  rows(tx, sql`select kind, status, amount_idr::bigint as amount from ledger_entries where order_id = ${orderId} order by created_at`);

suite("creditSaleForPayment — a sale is booked only for money actually collected", () => {
  it("books ONE pending sale for a berhasil payment, amount = amount_idr (never total)", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "baru");
      const payId = await mkPayment(tx, { orderId, storeId, amount: 150_000, total: 155_000, status: "berhasil" });
      await creditSaleForPayment(tx, payId);
      const l = await ledgerOf(tx, orderId);
      expect(l).toHaveLength(1);
      expect(l[0].kind).toBe("sale");
      expect(l[0].status).toBe("pending");
      expect(Number(l[0].amount)).toBe(150_000); // the amount owed, NOT the fee-inclusive total
    });
  });

  it("books the sale as AVAILABLE straight away when the order is already selesai", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "selesai");
      const payId = await mkPayment(tx, { orderId, storeId, amount: 100_000, status: "berhasil" });
      await creditSaleForPayment(tx, payId);
      const l = await ledgerOf(tx, orderId);
      expect(l[0].status).toBe("available");
    });
  });

  it("books NOTHING for a menunggu payment, or for a batal order", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const o1 = await mkOrder(tx, storeId, "baru");
      await creditSaleForPayment(tx, await mkPayment(tx, { orderId: o1, storeId, status: "menunggu" }));
      expect(await ledgerOf(tx, o1)).toHaveLength(0); // no money collected yet

      const o2 = await mkOrder(tx, storeId, "batal");
      await creditSaleForPayment(tx, await mkPayment(tx, { orderId: o2, storeId, status: "berhasil" }));
      expect(await ledgerOf(tx, o2)).toHaveLength(0); // cancelled → refunded, not credited
    });
  });

  it("is idempotent — firing twice credits once (callbacks retry, buttons double-click)", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "baru");
      const payId = await mkPayment(tx, { orderId, storeId, status: "berhasil" });
      await creditSaleForPayment(tx, payId);
      await creditSaleForPayment(tx, payId);
      expect(await ledgerOf(tx, orderId)).toHaveLength(1);
    });
  });

  it("double-credit is a DB IMPOSSIBILITY — the unique index rejects a second raw sale insert", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "baru");
      const payId = await mkPayment(tx, { orderId, storeId, status: "berhasil" });
      const one = sql`insert into ledger_entries (store_id, order_id, payment_id, kind, amount_idr) values (${storeId}, ${orderId}, ${payId}, 'sale', 100000)`;
      await tx.execute(one);
      // A second sale for the SAME payment must be refused by ledger_one_sale_per_payment, not by app code.
      await expect(tx.execute(one)).rejects.toThrow(/unique|duplicate/i);
    });
  });
});

suite("collectCodOnDelivery — cash exists only at the door", () => {
  it("flips a menunggu COD payment to berhasil and returns it; a second call is a no-op", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "dikirim");
      await mkPayment(tx, { orderId, storeId, method: "cod", amount: 100_000, status: "menunggu" });
      const first = await collectCodOnDelivery(tx, orderId);
      expect(first).toHaveLength(1);
      const paid = await rows(tx, sql`select status from payments where order_id = ${orderId}`);
      expect(paid[0].status).toBe("berhasil");
      expect(await collectCodOnDelivery(tx, orderId)).toHaveLength(0); // already berhasil
    });
  });
});

suite("settleOrderLedger — the book moves with the order status", () => {
  it("selesai on a COD order: collects the cash AND books the sale available", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "selesai"); // seller marked delivered
      await mkPayment(tx, { orderId, storeId, method: "cod", amount: 200_000, status: "menunggu" });
      await settleOrderLedger(tx, { storeId, orderId, status: "selesai", prevStatus: "dikirim" });
      const l = await ledgerOf(tx, orderId);
      expect(l).toHaveLength(1);
      expect(l[0].kind).toBe("sale");
      expect(l[0].status).toBe("available");
      expect(Number(l[0].amount)).toBe(200_000);
    });
  });

  it("releases a pending sale to available exactly at the release_on status", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "dikirim");
      await creditSaleForPayment(tx, await mkPayment(tx, { orderId, storeId, amount: 100_000, status: "berhasil" }));
      expect((await ledgerOf(tx, orderId))[0].status).toBe("pending"); // shipped, not yet released
      await tx.execute(sql`update orders set status = 'selesai' where id = ${orderId}`);
      await settleOrderLedger(tx, { storeId, orderId, status: "selesai", prevStatus: "dikirim" });
      expect((await ledgerOf(tx, orderId))[0].status).toBe("available");
    });
  });

  it("honours release_on = dikirim (the tunable knob is actually read)", async () => {
    await inTxn(async (tx) => {
      await tx.execute(sql`insert into platform_payout (release_on) values ('dikirim')
                           on conflict do nothing`);
      // ensure the single row says dikirim even if one already existed
      await tx.execute(sql`update platform_payout set release_on = 'dikirim'`);
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "dikirim");
      await creditSaleForPayment(tx, await mkPayment(tx, { orderId, storeId, amount: 100_000, status: "berhasil" }));
      await settleOrderLedger(tx, { storeId, orderId, status: "dikirim", prevStatus: "diproses" });
      expect((await ledgerOf(tx, orderId))[0].status).toBe("available"); // released at despatch
    });
  });

  it("retur claws the credit back as an OPPOSING entry that nets the balance to zero", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "selesai");
      await creditSaleForPayment(tx, await mkPayment(tx, { orderId, storeId, amount: 100_000, status: "berhasil" }));
      await tx.execute(sql`update orders set status = 'retur' where id = ${orderId}`);
      await settleOrderLedger(tx, { storeId, orderId, status: "retur", prevStatus: "selesai" });
      const l = await ledgerOf(tx, orderId);
      const retur = l.find((r) => r.kind === "retur")!;
      expect(retur).toBeTruthy();
      expect(Number(retur.amount)).toBe(-100_000);
      expect(retur.status).toBe("available"); // reverses an available sale out of available
      expect(l.reduce((s, r) => s + Number(r.amount), 0)).toBe(0); // pair nets to zero
    });
  });

  it("the claw-back carries the SALE's status — a pending sale is reversed out of PENDING (never negative-available)", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "dikirim"); // sale still pending (shipped, not delivered)
      await creditSaleForPayment(tx, await mkPayment(tx, { orderId, storeId, amount: 100_000, status: "berhasil" }));
      await tx.execute(sql`update orders set status = 'retur' where id = ${orderId}`);
      await settleOrderLedger(tx, { storeId, orderId, status: "retur", prevStatus: "dikirim" });
      const l = await ledgerOf(tx, orderId);
      const available = l.filter((r) => r.status === "available").reduce((s, r) => s + Number(r.amount), 0);
      const pending = l.filter((r) => r.status === "pending").reduce((s, r) => s + Number(r.amount), 0);
      expect(available).toBe(0); // nothing ever entered available → cannot go negative
      expect(pending).toBe(0); // pending sale +100k and pending retur -100k net out
    });
  });

  it("retur is idempotent — a second settle cannot double-refund (ledger_one_retur_per_order)", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "selesai");
      await creditSaleForPayment(tx, await mkPayment(tx, { orderId, storeId, amount: 100_000, status: "berhasil" }));
      await tx.execute(sql`update orders set status = 'retur' where id = ${orderId}`);
      // Both calls pass prevStatus != 'retur' so both reach the insert — the unique index is the guard.
      await settleOrderLedger(tx, { storeId, orderId, status: "retur", prevStatus: "selesai" });
      await settleOrderLedger(tx, { storeId, orderId, status: "retur", prevStatus: "selesai" });
      const returns = (await ledgerOf(tx, orderId)).filter((r) => r.kind === "retur");
      expect(returns).toHaveLength(1);
    });
  });

  it("batal reverses a PREPAID sale — cancelling after payment claws the credit back (not just retur)", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "diproses"); // prepaid, credited pending, not yet shipped
      await creditSaleForPayment(tx, await mkPayment(tx, { orderId, storeId, amount: 100_000, status: "berhasil" }));
      await tx.execute(sql`update orders set status = 'batal' where id = ${orderId}`);
      await settleOrderLedger(tx, { storeId, orderId, status: "batal", prevStatus: "diproses" });
      const l = await ledgerOf(tx, orderId);
      const rev = l.find((r) => r.kind === "retur")!; // reuses the reversal kind (one-per-order index)
      expect(rev).toBeTruthy();
      expect(Number(rev.amount)).toBe(-100_000);
      expect(l.reduce((s, r) => s + Number(r.amount), 0)).toBe(0); // sale + reversal net to zero
    });
  });

  it("batal on an UNPAID order books nothing — there is no sale to reverse", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "baru");
      await settleOrderLedger(tx, { storeId, orderId, status: "batal", prevStatus: "baru" });
      expect(await ledgerOf(tx, orderId)).toHaveLength(0);
    });
  });
});

// ── The order state machine's STOCK side — inventory restore on batal/retur ──────────────────────────
async function mkVariantWithStock(tx: Db, storeId: string, available: number): Promise<string> {
  const loc = await rows(tx, sql`insert into locations (store_id, name) values (${storeId}, 'Gudang') returning id`);
  const prod = await rows(tx, sql`insert into products (store_id, title, handle) values (${storeId}, 'Produk', ${"p-" + ++seq}) returning id`);
  const v = await rows(tx, sql`insert into product_variants (product_id, store_id) values (${prod[0].id}, ${storeId}) returning id`);
  await tx.execute(sql`insert into inventory_levels (variant_id, location_id, available) values (${v[0].id}, ${loc[0].id}, ${available})`);
  return v[0].id as string;
}
async function mkLineItem(tx: Db, orderId: string, variantId: string, qty: number) {
  await tx.execute(sql`insert into order_line_items (order_id, variant_id, title, qty) values (${orderId}, ${variantId}, 'Line', ${qty})`);
}
const stockOf = async (tx: Db, variantId: string) =>
  Number((await rows(tx, sql`select available from inventory_levels where variant_id = ${variantId}`))[0].available);
const payStatus = async (tx: Db, orderId: string) =>
  (await rows(tx, sql`select status from payments where order_id = ${orderId}`))[0]?.status;

suite("applyOrderStatusChange — the stock returns to the shelf on batal AND retur, exactly once", () => {
  beforeAll(async () => {
    if (!URL) return;
    process.env.DATABASE_URL ||= URL; // satisfy @tokophi/db's client init (unused here) with the test DB
    ({ applyOrderStatusChange } = await import("./order-status"));
  });

  it("batal puts the line-item quantities back into inventory", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const variantId = await mkVariantWithStock(tx, storeId, 10);
      const orderId = await mkOrder(tx, storeId, "dikirim");
      await mkLineItem(tx, orderId, variantId, 3);
      await applyOrderStatusChange(tx, { storeId, order: { id: orderId, status: "dikirim" }, status: "batal" });
      expect(await stockOf(tx, variantId)).toBe(13);
    });
  });

  it("retur restores stock too — a refused parcel is back on the shelf (missing this shrinks real stock)", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const variantId = await mkVariantWithStock(tx, storeId, 10);
      const orderId = await mkOrder(tx, storeId, "dikirim");
      await mkLineItem(tx, orderId, variantId, 4);
      await applyOrderStatusChange(tx, { storeId, order: { id: orderId, status: "dikirim" }, status: "retur" });
      expect(await stockOf(tx, variantId)).toBe(14);
    });
  });

  it("cannot double-restore — re-applying the SAME status is a no-op (guarded on previous status)", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const variantId = await mkVariantWithStock(tx, storeId, 10);
      const orderId = await mkOrder(tx, storeId, "dikirim");
      await mkLineItem(tx, orderId, variantId, 5);
      await applyOrderStatusChange(tx, { storeId, order: { id: orderId, status: "dikirim" }, status: "batal" });
      expect(await stockOf(tx, variantId)).toBe(15);
      // setOrderStatus re-reads the order, so the second call sees status already 'batal' → no restore.
      await applyOrderStatusChange(tx, { storeId, order: { id: orderId, status: "batal" }, status: "batal" });
      expect(await stockOf(tx, variantId)).toBe(15); // still 15, not 20
    });
  });

  it("terminal guard: batal → retur cannot double-restore (a cancelled order is done)", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const variantId = await mkVariantWithStock(tx, storeId, 10);
      const orderId = await mkOrder(tx, storeId, "dikirim");
      await mkLineItem(tx, orderId, variantId, 5);
      await applyOrderStatusChange(tx, { storeId, order: { id: orderId, status: "dikirim" }, status: "batal" });
      expect(await stockOf(tx, variantId)).toBe(15);
      // Different DESTINATION status but the source is terminal → must NOT restore a second time.
      await applyOrderStatusChange(tx, { storeId, order: { id: orderId, status: "batal" }, status: "retur" });
      expect(await stockOf(tx, variantId)).toBe(15); // still 15, not 20
    });
  });

  it("fails a still-pending payment so a cancelled order can't be marked paid later", async () => {
    await inTxn(async (tx) => {
      const storeId = await mkStore(tx);
      const orderId = await mkOrder(tx, storeId, "diproses");
      await mkPayment(tx, { orderId, storeId, method: "cod", status: "menunggu" });
      await applyOrderStatusChange(tx, { storeId, order: { id: orderId, status: "diproses" }, status: "batal" });
      expect(await payStatus(tx, orderId)).toBe("gagal");
    });
  });
});
