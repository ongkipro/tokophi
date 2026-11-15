import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// PAY-RETRY — what the PAYMENT CALLBACK does once an order can carry more than one instruction.
//
// Retry only ever issues a bill once the previous one is dead by OUR reading of the vendor's clock,
// so the money path must still hold when that reading is wrong (a screenshot of the old QR, a vendor
// that honours a bill a little past its stamp, a cancellation by the cron):
//   · one sale in the ledger per order, whatever order the PAIDs arrive in (ledger_one_sale_per_order);
//   · every other collected payment becomes a `refunds` row — money owed back, on the Super Admin's
//     Pencairan screen — instead of a console line;
//   · exactly one Purchase per order (event_id = purchase:{number}, unique per store+channel).
// Real PostgreSQL, real route: these are claims about SQL.

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);
const SECRET = `cb-retry-${runId}`;

let client: Sql;
let POST: (request: Request) => Promise<Response>;
let accountId = "";
let storeId = "";

const paid = (trx: string) =>
  POST(
    new Request("http://admin.test/api/public/pay/callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-callback-token": SECRET },
      body: JSON.stringify({ trx_id: trx, status: "PAID", amount: 100700 }),
    }),
  );

/** An order holding the two attempts a "Bayar ulang" leaves behind: the old one closed, the new one live. */
async function retriedOrder(status = "baru") {
  const number = `PHI-${randomUUID().slice(0, 12).toUpperCase()}`;
  const [o] = await client<{ id: string }[]>`
    insert into orders (store_id, number, status, financial_status, subtotal_idr, total_idr)
    values (${storeId}, ${number}, ${status}, 'pending', 100000, 100000) returning id`;
  const old = `TRX-${randomUUID().slice(0, 8)}`;
  const fresh = `TRX-${randomUUID().slice(0, 8)}`;
  await client`
    insert into payments (order_id, store_id, method, amount_idr, admin_fee, total, status, provider, reff_id, trx_id, channel_code, created_at)
    values (${o.id}, ${storeId}, 'qris', 100000, 700, 100700, 'gagal', 'autolaris', ${number}, ${old}, 'QRIS', now() - interval '3 hours'),
           (${o.id}, ${storeId}, 'qris', 100000, 700, 100700, 'menunggu', 'autolaris', ${`${number}-2`}, ${fresh}, 'QRIS', now())`;
  // The conversion the checkout queued and HELD (tracking-events.ts → HOLD_UNTIL).
  await client`
    insert into tracking_event_deliveries (store_id, channel, event_name, event_id, order_id, next_attempt_at)
    values (${storeId}, 'meta', 'Purchase', ${`purchase:${number}`}, ${o.id}, '2126-01-01T00:00:00Z')`;
  return { id: o.id, number, old, fresh };
}

const book = async (orderId: string) => {
  const sales = await client<{ payment_id: string }[]>`
    select payment_id from ledger_entries where order_id = ${orderId} and kind = 'sale'`;
  const refunds = await client<{ payment_id: string; amount_idr: string; reason: string; status: string }[]>`
    select payment_id, amount_idr, reason, status from refunds where order_id = ${orderId}`;
  const pays = await client<{ trx_id: string; id: string; status: string }[]>`
    select trx_id, id, status from payments where order_id = ${orderId}`;
  const purchases = await client<{ next_attempt_at: Date }[]>`
    select next_attempt_at from tracking_event_deliveries where order_id = ${orderId} and event_name = 'Purchase'`;
  const [order] = await client<{ financial_status: string }[]>`select financial_status from orders where id = ${orderId}`;
  const idOf = (trx: string) => pays.find((p) => p.trx_id === trx)!.id;
  const statusOf = (trx: string) => pays.find((p) => p.trx_id === trx)!.status;
  return { sales, refunds, purchases, order, idOf, statusOf };
};

beforeAll(async () => {
  if (!URL) return;
  process.env.AUTOLARIS_CALLBACK_SECRET = SECRET;
  process.env.DATABASE_URL = URL;
  client = postgres(URL, { max: 4 });
  ({ POST } = await import("./route"));
  const [account] = await client<{ id: string }[]>`
    insert into accounts (name) values (${`CbRetry ${runId}`}) returning id`;
  accountId = account.id;
  const [store] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status) values (${accountId}, ${`CbRetry ${runId}`}, ${`cb-retry-${runId}`}, 'active')
    returning id`;
  storeId = store.id;
  await client`
    insert into store_tracking_channels (store_id, channel, enabled, pixel_id, capi_enabled, capi_token_ciphertext)
    values (${storeId}, 'meta', true, '1234567890', true, 'not-a-real-ciphertext')`;
});

afterAll(async () => {
  if (!client) return;
  await client`delete from refunds where store_id = ${storeId}`;
  await client`delete from ledger_entries where store_id = ${storeId}`;
  await client`delete from tracking_event_deliveries where store_id = ${storeId}`;
  await client`delete from store_tracking_channels where store_id = ${storeId}`;
  await client`delete from payments where store_id = ${storeId}`;
  await client`delete from orders where store_id = ${storeId}`;
  await client`delete from stores where id = ${storeId}`;
  await client`delete from accounts where id = ${accountId}`;
  await client.end();
});

suite("pay/callback after a retry (real PostgreSQL)", () => {
  it("new bill paid, then the OLD one paid late: one sale, the late one owed back, one Purchase", async () => {
    const o = await retriedOrder();
    expect((await paid(o.fresh)).status).toBe(200);
    let b = await book(o.id);
    expect(b.order.financial_status).toBe("dibayar");
    expect(b.sales.map((s) => s.payment_id)).toEqual([b.idOf(o.fresh)]);
    expect(b.refunds).toEqual([]);
    expect(b.purchases).toHaveLength(1);
    expect(b.purchases[0].next_attempt_at.getTime()).toBeLessThan(Date.parse("2100-01-01"));

    // The screenshot of the old QR — `gagal → berhasil` is legal, the money is real.
    expect((await paid(o.old)).status).toBe(200);
    // …and AutoLaris retries its callback: nothing may double.
    expect((await paid(o.old)).status).toBe(200);
    b = await book(o.id);
    expect(b.statusOf(o.old)).toBe("berhasil");
    expect(b.sales.map((s) => s.payment_id), "one sale per order").toEqual([b.idOf(o.fresh)]);
    expect(b.refunds).toEqual([
      { payment_id: b.idOf(o.old), amount_idr: "100000", reason: "Pembayaran ganda", status: "menunggu" },
    ]);
    expect(b.purchases, "exactly one Purchase for the order").toHaveLength(1);
  });

  it("the same pair in the OTHER order: whichever lands first is the sale, the other is the refund", async () => {
    const o = await retriedOrder();
    await paid(o.old);
    let b = await book(o.id);
    // The old bill paid first: the still-live new one is closed so nothing offers it as payable.
    expect(b.statusOf(o.fresh)).toBe("gagal");
    await paid(o.fresh);
    b = await book(o.id);
    expect(b.sales.map((s) => s.payment_id)).toEqual([b.idOf(o.old)]);
    expect(b.refunds.map((r) => [r.payment_id, r.reason])).toEqual([[b.idOf(o.fresh), "Pembayaran ganda"]]);
  });

  it("PAID on an order the cron already cancelled: no sale, a refund row (it used to be a log line only)", async () => {
    const o = await retriedOrder("batal");
    await paid(o.fresh);
    const b = await book(o.id);
    expect(b.sales).toEqual([]);
    expect(b.order.financial_status).toBe("pending");
    expect(b.refunds.map((r) => [r.payment_id, r.reason])).toEqual([[b.idOf(o.fresh), "Dibayar setelah pesanan ditutup"]]);
  });

  it("a refund already SETTLED is not reopened by a replayed callback", async () => {
    const o = await retriedOrder();
    await paid(o.fresh);
    await paid(o.old);
    await client`update refunds set status = 'selesai', note = 'TRF-1', paid_at = now() where order_id = ${o.id}`;
    await paid(o.old);
    const b = await book(o.id);
    expect(b.refunds.map((r) => r.status)).toEqual(["selesai"]);
  });
});
