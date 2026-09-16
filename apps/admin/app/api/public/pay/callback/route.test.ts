import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { codeOnly } from "../../../../../../../test/source-code";

// Task 4.10 — PAID IS TERMINAL FOR A CALLBACK.
//
// The payments branch of this handler already refuses to walk a collected payment backwards
// (`ne(status, "berhasil")`, with a comment recording the outage that taught it). The INVOICE branch
// did not: its only guard was `ne(status, invStatus)`, so a late EXPIRED flipped a paid subscription
// invoice to `gagal` and nulled `paid_at`, and the ordinary out-of-order pair
// **paid → expired → paid** then found a claimable row again and extended the store's subscription a
// SECOND time. A VA lives 24 h; callbacks arriving out of order are the normal case here.
//
// These drive the real route handler against real PostgreSQL, because the claim being made is about
// a SQL WHERE clause — a mock of the database could only prove that the mock agrees with itself.

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);
const SECRET = `cb-secret-${runId}`;

let client: Sql;
let POST: (request: Request) => Promise<Response>;
let accountId = "";
let storeId = "";

const callback = (body: Record<string, unknown>) =>
  POST(
    new Request("http://admin.test/api/public/pay/callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-callback-token": SECRET },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  if (!URL) return;
  process.env.AUTOLARIS_CALLBACK_SECRET = SECRET;
  process.env.DATABASE_URL = URL;
  client = postgres(URL, { max: 4 });
  ({ POST } = await import("./route"));

  const [account] = await client<{ id: string }[]>`
    insert into accounts (name) values (${`Callback ${runId}`}) returning id`;
  accountId = account.id;
  const [store] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status, current_period_end)
    values (${accountId}, ${`Callback ${runId}`}, ${`callback-${runId}`}, 'trial', null)
    returning id`;
  storeId = store.id;
});

afterAll(async () => {
  if (!client) return;
  await client`delete from invoices where store_id = ${storeId}`;
  await client`delete from stores where id = ${storeId}`;
  await client`delete from accounts where id = ${accountId}`;
  await client.end();
});

async function newInvoice(label: string) {
  const trx = `TRX-${runId}-${label}`;
  await client`
    insert into invoices (account_id, store_id, plan_key, kind, number, amount_idr, status, trx_id, period_months)
    values (${accountId}, ${storeId}, 'bisnis', 'subscription', ${`INV-${runId}-${label}`}, 100000, 'menunggu', ${trx}, 1)`;
  await client`update stores set current_period_end = null, status = 'trial' where id = ${storeId}`;
  return trx;
}

const state = async (trx: string) => {
  const [inv] = await client<{ status: string; paid_at: Date | null }[]>`
    select status, paid_at from invoices where trx_id = ${trx}`;
  const [store] = await client<{ current_period_end: Date | null }[]>`
    select current_period_end from stores where id = ${storeId}`;
  return { invoice: inv, periodEnd: store.current_period_end };
};

// The subscription extension reads `current_period_end`, adds months in JS and writes it back. Two
// DIFFERENT invoices of one store paid at the same moment both read the pre-extension value and the
// second write erases the first — the merchant pays twice and is credited once. `for update` inside
// a transaction is what makes the second reader wait. A race is not reliably reproducible from a
// test (proved above), so the claim is made about the CODE, the way this repo's other unreachable
// claims are (`apps/admin/lib/public-guard.test.ts`), with the same self-proof.
describe("the subscription extension holds a row lock", () => {
  const src = () => readFileSync(new globalThis.URL("./route.ts", import.meta.url), "utf8");
  const locked = (code: string) =>
    /db\s*\.\s*transaction\s*\(/.test(code) && /\.\s*for\s*\(\s*"update"\s*\)/.test(code);

  it("reads and writes stores.current_period_end inside a transaction, for update", () => {
    expect(locked(codeOnly(src()))).toBe(true);
  });

  // Put the shipped bug back and the predicate must catch it. A source guard nobody has seen red is
  // green for reasons nobody has checked.
  it("goes red on the un-transacted read-modify-write", () => {
    const reverted = src()
      .replace(/await db\.transaction\(async \(tx\) => \{/, "{")
      .replace(/\.for\("update"\)\n/, "");
    expect(locked(codeOnly(reverted))).toBe(false);
  });
});

suite("pay/callback subscription invoices (real PostgreSQL)", () => {
  it("paid → expired: tetap dibayar, paid_at tidak dihapus, periode tidak mundur", async () => {
    const trx = await newInvoice("a");
    await callback({ trx_id: trx, status: "PAID", amount: 100000 });
    const afterPaid = await state(trx);
    expect(afterPaid.invoice.status).toBe("dibayar");
    expect(afterPaid.periodEnd).not.toBeNull();

    await callback({ trx_id: trx, status: "EXPIRED", amount: 100000 });
    const afterExpired = await state(trx);
    expect(afterExpired.invoice.status, "uang yang diterima tidak di-tidak-terima-kan").toBe("dibayar");
    expect(afterExpired.invoice.paid_at).not.toBeNull();
    expect(afterExpired.periodEnd?.getTime()).toBe(afterPaid.periodEnd?.getTime());
  });

  it("paid → paid: perpanjangan tepat SEKALI", async () => {
    const trx = await newInvoice("b");
    await callback({ trx_id: trx, status: "PAID", amount: 100000 });
    const once = await state(trx);
    await callback({ trx_id: trx, status: "PAID", amount: 100000 });
    const twice = await state(trx);
    expect(twice.periodEnd?.getTime()).toBe(once.periodEnd?.getTime());
  });

  // ⚠️ THIS IS AN OUTCOME TEST, NOT THE ROW LOCK'S GUARD — and the difference was measured, not
  // assumed. Two invoices of one store, paid together, must buy two months. Run against a copy with
  // the `for update` transaction replaced by the old un-transacted read-modify-write, it passed
  // three times out of three: `Promise.all` does not reliably interleave two handlers at the one
  // statement that matters, so this can never be the proof that the lock is present. The lock's
  // guard is the source assertion at the bottom of this file, which HAS been proved red.
  it("dua invoice satu toko dibayar bersamaan: dua bulan, bukan satu", async () => {
    const a = await newInvoice("d");
    const b = await newInvoice("e"); // newInvoice mengosongkan periode, jadi urutannya penting
    await Promise.all([
      callback({ trx_id: a, status: "PAID", amount: 100000 }),
      callback({ trx_id: b, status: "PAID", amount: 100000 }),
    ]);
    const [store] = await client<{ current_period_end: Date }[]>`
      select current_period_end from stores where id = ${storeId}`;
    // dua invoice × 1 bulan, dihitung dari "sekarang" (periode dikosongkan di newInvoice)
    const twoMonths = new Date();
    twoMonths.setMonth(twoMonths.getMonth() + 2);
    const driftDays =
      Math.abs(store.current_period_end.getTime() - twoMonths.getTime()) / 86_400_000;
    expect(driftDays, `periode berakhir ${store.current_period_end.toISOString()}`).toBeLessThan(1);
  });

  // 🔴 Urutan yang benar-benar terjadi di lapangan, dan yang dulu memberi bulan gratis.
  it("paid → expired → paid: status bertahan dan periode TIDAK diperpanjang dua kali", async () => {
    const trx = await newInvoice("c");
    await callback({ trx_id: trx, status: "PAID", amount: 100000 });
    const once = await state(trx);
    await callback({ trx_id: trx, status: "EXPIRED", amount: 100000 });
    await callback({ trx_id: trx, status: "PAID", amount: 100000 });
    const after = await state(trx);
    expect(after.invoice.status).toBe("dibayar");
    expect(after.periodEnd?.getTime(), "satu tagihan = satu bulan").toBe(once.periodEnd?.getTime());
  });
});

// Task 8.25 (a) — the bill is issued for `payments.total` (= buyerPayable, our fee included), so a
// PSP that echoes what it collected reports THAT number, and a PAID at exactly `amount_idr` (the
// pre-fee figure the old create_payment flow reported) must keep settling too. Anything else is
// still ignored — the exact-amount gate is what stops a partial transfer marking an order paid.
suite("the paid callback matches the amount we billed", () => {
  let customerId = "";

  beforeAll(async () => {
    const [customer] = await client<{ id: string }[]>`
      insert into customers (store_id, name, phone)
      values (${storeId}, ${`Pembeli ${runId}`}, '628123450000') returning id`;
    customerId = customer.id;
  });

  afterAll(async () => {
    await client`delete from ledger_entries where store_id = ${storeId}`;
    await client`delete from payments where store_id = ${storeId}`;
    await client`delete from orders where store_id = ${storeId}`;
    await client`delete from customers where id = ${customerId}`;
  });

  async function newPayment(label: string) {
    const trx = `TRXP-${runId}-${label}`;
    const [order] = await client<{ id: string }[]>`
      insert into orders (store_id, customer_id, number, status, financial_status, subtotal_idr, total_idr)
      values (${storeId}, ${customerId}, ${`PAY-${runId}-${label}`}, 'baru', 'pending', 100000, 100000) returning id`;
    // amount_idr = order payable · admin_fee = OUR VA BCA fee · total = buyerPayable — all written by us.
    await client`
      insert into payments (order_id, store_id, method, amount_idr, admin_fee, total, status, provider, reff_id, trx_id, channel_code)
      values (${order.id}, ${storeId}, 'va', 100000, 6500, 106500, 'menunggu', 'autolaris', ${`PAY-${runId}-${label}`}, ${trx}, 'VABCA')`;
    return trx;
  }

  const paymentState = async (trx: string) => {
    const [p] = await client<{ status: string; financial_status: string }[]>`
      select p.status::text, o.financial_status::text
        from payments p join orders o on o.id = p.order_id where p.trx_id = ${trx}`;
    return p;
  };

  it("PAID at payments.total (fee included) settles the payment and the order", async () => {
    const trx = await newPayment("t");
    const res = await callback({ trx_id: trx, status: "PAID", amount: 106500 });
    expect(res.status).toBe(200);
    expect(await paymentState(trx)).toEqual({ status: "berhasil", financial_status: "dibayar" });
  });

  it("PAID at amount_idr (the pre-fee figure) still settles", async () => {
    const trx = await newPayment("a");
    await callback({ trx_id: trx, status: "PAID", amount: 100000 });
    expect(await paymentState(trx)).toEqual({ status: "berhasil", financial_status: "dibayar" });
  });

  it("PAID at any other amount is ignored — the exact-amount gate holds", async () => {
    const trx = await newPayment("x");
    await callback({ trx_id: trx, status: "PAID", amount: 99000 });
    expect(await paymentState(trx)).toEqual({ status: "menunggu", financial_status: "pending" });
  });
});
