import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/tenant";

// Bulk "Cetak resi" — one parcel, one label, one payment method.
//
// WHY THIS FILE EXISTS. `getBulkLabels` joined `payments` with a plain
// `left join payments p on p.order_id = o.id`. `payments` routinely holds MORE THAN ONE row per
// order — a `gagal` VA beside the COD that was actually collected, or a second bill raised after
// the first expired; the whole of `lib/data/order-payment.ts` exists because of that shape. The
// join therefore FANNED OUT: one order produced one label PER PAYMENT ROW, and `isCod` came from
// whichever row Postgres happened to emit first. Measured on real Postgres before the fix: an order
// with a failed `va` and a collected `cod` printed TWO labels for ONE AWB — one reading
// "COD (Bayar di Tempat)" with a rupiah figure to collect, the other "Sudah dibayar". A courier
// scanning the wrong one collects nothing on a COD parcel, or asks a prepaid buyer to pay twice.
//
// Neither `tsc`, ESLint nor `next build` can see a fan-out, and the dev DB happens to carry at most
// one payment per order, so the screen looks right until the first order that takes a second
// payment. Only Postgres, on that shape, gives the wrong answer.
//
// It runs the REAL exported query + the REAL renderer against a throwaway database, everything
// inside a transaction that is always rolled back — the same seam `daily-stats.test.ts` uses.
//
//   TEST_DATABASE_URL=postgresql://tokophi:tokophi@localhost:5433/tokophi_test \
//     npx vitest run apps/admin/lib/data/bulk-labels.test.ts

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
type Db = typeof db;
// `bulk-labels.ts` pulls `@tokophi/db` transitively, which throws at import time with no
// DATABASE_URL — so it is dynamic-imported after pointing that at the throwaway DB.
let bulkLabels: (db: Tx, numbers: string[]) => Promise<{ html: string | null; skipped: string[] }>;

beforeAll(async () => {
  if (!URL) return;
  process.env.DATABASE_URL ??= URL;
  ({ bulkLabels } = await import("./bulk-labels"));
  client = postgres(URL, { max: 1 });
  // Must match @tokophi/db's client, or the query builder emits "orderId" instead of "order_id".
  db = drizzle(client, { casing: "snake_case" });
});
afterAll(async () => {
  if (client) await client.end();
});

class Rollback extends Error {}
async function inTxn(fn: (tx: Db) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** A shipped order carrying a real AWB, plus the payment rows the test needs. */
async function mkOrder(
  tx: Db,
  payments: { method: string; status: string; paid: boolean }[],
): Promise<string> {
  const [acc] = await tx.execute<{ id: string }>(sql`insert into accounts (name) values ('Label Acc') returning id`);
  const [store] = await tx.execute<{ id: string }>(
    sql`insert into stores (account_id, name, slug) values (${acc.id}, 'Label Store', ${"lbl-" + Math.random()}) returning id`,
  );
  const number = "LBL-" + Math.floor(Math.random() * 1e9);
  const [o] = await tx.execute<{ id: string }>(sql`
    insert into orders (store_id, number, status, awb, courier, service_type, total_idr, ship_recipient, ship_address, city)
    values (${store.id}, ${number}, 'dikirim', 'SPX1234567890', 'spx', '1', 150000, 'Siti', 'Jl. Melati 1', 'Bantul')
    returning id`);
  for (const p of payments) {
    await tx.execute(sql`
      insert into payments (order_id, store_id, method, status, paid_at)
      values (${o.id}, ${store.id}, ${p.method}::payment_method, ${p.status}::payment_status,
              ${p.paid ? sql`now()` : sql`null`})`);
  }
  return number;
}

/** How many thermal labels the returned document actually carries. */
const labelCount = (html: string | null) => (html ? html.match(/class="label"/g)?.length ?? 0 : 0);

suite("bulk labels — one parcel, one label", () => {
  it("an order with TWO payment rows still prints exactly ONE label", async () => {
    await inTxn(async (tx) => {
      // Inserted unpaid-first so row order alone cannot produce the right answer.
      const number = await mkOrder(tx, [
        { method: "va", status: "gagal", paid: false },
        { method: "cod", status: "berhasil", paid: true },
      ]);
      const { html, skipped } = await bulkLabels(tx as unknown as Tx, [number]);
      expect(skipped).toEqual([]);
      // The unfixed `left join payments` emitted 2 here — two labels, one AWB.
      expect(labelCount(html)).toBe(1);
    });
  });

  it("that one label names the COLLECTED payment — the courier's cash instruction", async () => {
    await inTxn(async (tx) => {
      const number = await mkOrder(tx, [
        { method: "va", status: "gagal", paid: false },
        { method: "cod", status: "berhasil", paid: true },
      ]);
      const { html } = await bulkLabels(tx as unknown as Tx, [number]);
      // Same answer as `latestPaymentFirst()` gives the Pesanan list and the order detail.
      // The COD box carries the cash the courier must collect; NON-COD is the other branch of the
      // same slot in `buildLabelHtml`, so exactly one of them may appear.
      expect(html).toContain('<div class="cod">COD<br>');
      expect(html).not.toContain("NON-COD");
    });
  });

  it("a PREPAID order is never labelled COD, even with a stale COD row behind it", async () => {
    await inTxn(async (tx) => {
      const number = await mkOrder(tx, [
        { method: "cod", status: "gagal", paid: false },
        { method: "va", status: "berhasil", paid: true },
      ]);
      const { html } = await bulkLabels(tx as unknown as Tx, [number]);
      expect(labelCount(html)).toBe(1);
      expect(html).not.toContain('<div class="cod">COD<br>');
      expect(html).toContain("NON-COD<br><b>VA</b>");
    });
  });

  it("an order with no payment row at all still prints its one label", async () => {
    await inTxn(async (tx) => {
      const number = await mkOrder(tx, []);
      const { html, skipped } = await bulkLabels(tx as unknown as Tx, [number]);
      expect(skipped).toEqual([]);
      expect(labelCount(html)).toBe(1);
      expect(html).toContain("NON-COD<br><b>Sudah dibayar</b>");
    });
  });
});
