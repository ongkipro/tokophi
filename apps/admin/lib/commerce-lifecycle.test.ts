import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import { paymentFee } from "@tokophi/lib/payment-fees";
import type * as ShippingQuote from "@/lib/shipping-quote";
import type * as Autolaris from "@tokophi/lib/autolaris";
import type { Tx } from "@/lib/tenant";
import type { Db } from "./ledger-credit";

// ── Task 5.7 / NF-9 — THE WHOLE COMMERCE LIFECYCLE, ONCE, END TO END ────────────────────────────
//
// Every step below already has a unit test. What none of them can see is the SEAM: the order route
// writes a payment row, the callback finds it by `trx_id`, the status machine moves the order, the
// ledger decides when the money becomes withdrawable, and `requestPayout` spends it — five modules
// that only ever meet in production. Three shipped defects lived exactly in those joins (a callback
// that walked a paid invoice backwards, a booking guard reading a column that was never its own, an
// order route whose preflight let two orders through), and each passed every unit test around it.
//
// WHAT IS REAL: PostgreSQL (the `_test` database `test/db-setup.ts` migrates to head), the order
// route handler, the payment callback handler, the order state machine, the ledger, the payout
// booking, RLS under `tokophi_app`. WHAT IS STUBBED — only the three NETWORK boundaries:
//   · `quoteShipping`  — the KiriminAja rate call. The ROUTE still re-quotes, matches the shopper's
//                        pick on courier+type and writes the price WE computed, which is the rule.
//   · `areaById`       — the district lookup (a local snapshot table the seed fills; this suite
//                        seeds nothing platform-wide, so it answers the one district it needs).
//   · `alCreateOrder` — the AutoLaris bill (`submit`). The mock echoes the PSP's own shape (amount / admin /
//                        total) so the route's fee reconciliation runs the code path production runs.
// A test that phones a vendor fails on their bad afternoon; `npm run test:db` must be deterministic.
//
// EVERY MONEY ASSERTION RECONCILES AGAINST SQL, never against a function's own return value: the
// fee against `@tokophi/lib/payment-fees` (the schedule the route is bound to), the ledger against
// `ledger_entries`, the balance against `Σ amount_idr` — the same expression `requestPayout` uses,
// because there is no stored balance column and there must not be.
//
// ⚠️ It must FAIL on: a duplicate ledger credit, stock drift, a cross-tenant read OR write, a wrong
// order transition, or a payment walked backwards. Each is asserted below.

vi.mock("@/lib/shipping-quote", async (importOriginal) => {
  const actual = await importOriginal<typeof ShippingQuote>();
  return {
    ...actual,
    quoteShipping: vi.fn(async () => ({
      ok: true as const,
      rates: [{ name: "JNE REG", code: "jne", type: "REG23", cost: 15_000, etd: "2-3 hari", cod: false, group: "reguler" }],
      grams: 1_000,
      billableGrams: 1_000,
      weightFallback: [],
      codEnabled: false,
      origin: 6138,
      originFrom: "pickup" as const,
      originName: "Gudang Life",
    })),
  };
});
vi.mock("@/lib/data/areas", () => ({
  areaById: vi.fn(async () => ({
    id: 2107,
    text: "Mampang Prapatan, Jakarta Selatan, DKI Jakarta",
    district: "Mampang Prapatan",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
  })),
  // The destination subdistrict is resolved against the district (Task 8.17). These fixtures name no
  // kelurahan, which is the ORDINARY case — the checkout only asks where the postcode is ambiguous —
  // so the honest stub is "nothing resolved" and the order stores NULL for both columns.
  resolveDestinationKelurahan: vi.fn(async () => null),
}));
// What the PSP was actually asked to collect — captured so the test can assert the bill's AMOUNT,
// not only the row the route wrote afterwards (a route billing `total` but writing `total + fee`
// would pass every DB assertion and still under-bill every shopper).
const { billed } = vi.hoisted(() => ({ billed: [] as number[] }));
vi.mock("@tokophi/lib/autolaris", async (importOriginal) => {
  const actual = await importOriginal<typeof Autolaris>();
  return {
    ...actual,
    autolarisConfigured: () => true, // so the route writes the pending payment row it would in prod
    // Task 8.25 (a): the order API submits `buyerPayable` (fee included) to the `submit` endpoint,
    // whose `total` IS `grand_total` — the provider's own fee (`admin`) nets against settlement and is
    // never added to what the buyer pays. The mock echoes exactly that contract.
    alCreateOrder: vi.fn(async (input: { amount: number }) => ({
      ok: (billed.push(input.amount), true as const),
      trxId: `TRX-${randomUUID().slice(0, 8)}`,
      virtualAccount: "8808123456789",
      amount: input.amount,
      admin: 6_500,
      total: input.amount,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })),
  };
});

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);

let client: Sql;
let rootDb: Db;
let POST: (req: Request) => Promise<Response>;
let CALLBACK: (req: Request) => Promise<Response>;
let applyOrderStatusChange: typeof import("./order-status").applyOrderStatusChange;
let requestPayoutInTenant: typeof import("./payout").requestPayoutInTenant;

const A = { accountId: "", storeId: "", variantId: "", slug: `life-${runId}-a`, handle: `life-${runId}` };
const B = { accountId: "", storeId: "", slug: `life-${runId}-b` };
// Shared between the two tests: the RLS probe needs a real order of A's to fail to see.
let orderId = "";

const PRICE = 100_000;
const QTY = 2;
const SHIPPING = 15_000;

async function seedStore(label: "a" | "b", withProduct: boolean) {
  const t = `${runId}-${label}`;
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`Life ${t}`}) returning id`;
  const [st] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status, approved_at)
    values (${acc.id}, ${`Life ${t}`}, ${`life-${t}`}, 'active', now()) returning id`;
  // Bank details are what `requestPayout` refuses without; the tax switch stays at its default (off).
  await client`
    insert into store_settings (store_id, sender_kecamatan_id, bank_name, bank_account, bank_holder)
    values (${st.id}, 6138, 'Bank Life', '1234567890', ${`Life ${t}`})`;
  if (!withProduct) return { accountId: acc.id, storeId: st.id, variantId: "" };
  const [pr] = await client<{ id: string }[]>`
    insert into products (store_id, title, handle, status, number, length_cm, width_cm, height_cm)
    values (${st.id}, 'Kain', ${A.handle}, 'active', 4001, 10, 10, 10) returning id`;
  const [v] = await client<{ id: string }[]>`
    insert into product_variants (product_id, store_id, title, price_idr, weight_grams, position, seq)
    values (${pr.id}, ${st.id}, 'Default', ${PRICE}, 500, 0, 1) returning id`;
  const [loc] = await client<{ id: string }[]>`
    insert into locations (store_id, name, is_default) values (${st.id}, 'Gudang', true) returning id`;
  await client`insert into inventory_levels (variant_id, location_id, available) values (${v.id}, ${loc.id}, 10)`;
  return { accountId: acc.id, storeId: st.id, variantId: v.id };
}

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  process.env.AUTOLARIS_CALLBACK_SECRET = `life-${runId}`;
  client = postgres(URL_, { max: 6 });
  // Dynamic on purpose: these modules open a pool at import, and it must point at the `_test` database.
  ({ POST } = await import("../app/api/public/order/route"));
  ({ POST: CALLBACK } = await import("../app/api/public/pay/callback/route"));
  ({ applyOrderStatusChange } = await import("./order-status"));
  ({ requestPayoutInTenant } = await import("./payout"));
  rootDb = (await import("@tokophi/db")).db;

  Object.assign(A, await seedStore("a", true));
  Object.assign(B, await seedStore("b", false));
  // Payment channels are a PLATFORM decision (ADR 0004) — the route reads the platform list, never a
  // per-store one, and refuses before it writes without an ACTIVE+ENABLED row. `channel` carries no
  // unique index, so this is "make sure exactly one usable VABCA row exists", not an upsert.
  await client`delete from platform_payment_channels where channel = 'VABCA'`;
  await client`insert into platform_payment_channels (channel, label, kind, active, enabled)
    values ('VABCA', 'VA BCA', 'va', true, true)`;
});

afterAll(async () => {
  if (!client) return;
  if (A.accountId || B.accountId) {
    const accounts = [A.accountId, B.accountId].filter(Boolean);
    await client.begin(async (sql) => {
      // Test-only cleanup: the immutable financial rows deliberately reject an ordinary DELETE.
      await sql`set local session_replication_role = 'replica'`;
      const stores = sql`select id from stores where account_id in ${sql(accounts)}`;
      await sql`delete from ledger_entries where store_id in (${stores})`;
      await sql`delete from payouts where store_id in (${stores})`;
      await sql`delete from tracking_event_deliveries where store_id in (${stores})`;
      await sql`delete from payments where store_id in (${stores})`;
      await sql`delete from order_financials where store_id in (${stores})`;
      await sql`delete from order_line_items li using orders o where li.order_id = o.id and o.store_id in (${stores})`;
      await sql`delete from checkout_sessions where store_id in (${stores})`;
      await sql`delete from orders where store_id in (${stores})`;
      await sql`delete from customer_addresses a using customers c where a.customer_id = c.id and c.store_id in (${stores})`;
      await sql`delete from customers where store_id in (${stores})`;
      await sql`delete from inventory_levels il using product_variants v where il.variant_id = v.id and v.store_id in (${stores})`;
      await sql`delete from product_variants where store_id in (${stores})`;
      await sql`delete from products where store_id in (${stores})`;
      await sql`delete from locations where store_id in (${stores})`;
      await sql`delete from store_settings where store_id in (${stores})`;
      await sql`delete from stores where account_id in ${sql(accounts)}`;
      await sql`delete from accounts where id in ${sql(accounts)}`;
    });
  }
  await client.end();
});

// ── SQL readers — the truth every assertion is reconciled against ───────────────────────────────
const stock = async () => {
  const [r] = await client<{ available: number }[]>`
    select available from inventory_levels where variant_id = ${A.variantId}`;
  return Number(r.available);
};
const ledger = async (oid: string) => {
  const rows = await client<{ kind: string; status: string; amount_idr: string; available_at: Date | null }[]>`
    select kind::text, status::text, amount_idr, available_at from ledger_entries where order_id = ${oid}
     order by created_at, kind desc`; // `id` is a random UUID — never an order. sale before retur, deterministically.
  return rows.map((r) => ({ kind: r.kind, status: r.status, amount: Number(r.amount_idr), released: r.available_at !== null }));
};
// `Σ amount_idr WHERE status='available'` — the SAME expression `requestPayoutInTenant` sums. It must
// never join `orders`: a payout row has `order_id IS NULL` by design, and an inner join would hand the
// withdrawn money back (AGENTS.md → "Order lifecycle").
const available = async (storeId: string) => {
  const [r] = await client<{ n: string }[]>`
    select coalesce(sum(amount_idr), 0)::text as n from ledger_entries where store_id = ${storeId} and status = 'available'`;
  return Number(r.n);
};
const orderRow = async (oid: string) => {
  const [r] = await client<{ status: string; financial_status: string }[]>`
    select status::text, financial_status::text from orders where id = ${oid}`;
  return r;
};
const paymentRow = async (oid: string) => {
  const [r] = await client<{ status: string; paid_at: Date | null; trx_id: string | null }[]>`
    select status::text, paid_at, trx_id from payments where order_id = ${oid}`;
  return r;
};

// The admin's own shape: `setOrderStatus` / `requestPayout` run inside `withTenant` — GUC set, role
// dropped to `tokophi_app` — so the state machine and the payout are exercised under RLS, the way
// production runs them, not on the owner connection.
const asTenant = <T>(storeId: string, fn: (tx: Tx) => Promise<T>) =>
  rootDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
    await tx.execute(sql`set local role tokophi_app`);
    return fn(tx as unknown as Tx);
  });
const move = async (status: "diproses" | "dikirim" | "selesai" | "batal" | "retur", returnReason?: string) => {
  // Current status read from SQL — the guard depends on it, and the row is the only honest source.
  const cur = (await orderRow(orderId)).status as "baru" | "diproses" | "dikirim" | "selesai" | "batal" | "retur";
  return asTenant(A.storeId, (tx) =>
    applyOrderStatusChange(tx as unknown as Db, { storeId: A.storeId, order: { id: orderId, status: cur }, status, returnReason }),
  );
};

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/public/order", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  }));

const callback = (trx: string, status: "PAID" | "EXPIRED", amount: number) =>
  CALLBACK(new Request("http://localhost/api/public/pay/callback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-callback-token": process.env.AUTOLARIS_CALLBACK_SECRET! },
    body: JSON.stringify({ trx_id: trx, status, amount }),
  }));

suite("the commerce lifecycle, end to end (real PostgreSQL)", () => {
  it("cart → order → payment → delivery → payout → return, with the money right at every step", async () => {
    const before = await stock();

    // ① ORDER. The route prices it itself — `items[].price` prices NOTHING. A cart holding a stale
    // number is REFUSED (409 + the corrected prices), never silently repriced, and nothing is written.
    const cart = (price: number) => ({
      storeSlug: A.slug,
      sessionId: `sess-${runId}`,
      items: [{ handle: A.handle, variant: "Default", qty: QTY, price }],
      customer: { name: "Budi Santoso", phone: "0812 3456 7890" },
      address: { alamat: "Jl. Merdeka No. 10, RT 01/RW 02", kota: "klaim browser", provinsi: "klaim browser", kodepos: "12790" },
      shipping: { destId: 2107, service: "jne", serviceType: "REG23" },
      channelCode: "VABCA",
    });
    const stale = await post(cart(1));
    expect(stale.status).toBe(409);
    expect((await stale.json()).repriced).toEqual([{ handle: A.handle, variant: "Default", price: PRICE }]);
    expect((await client<{ n: string }[]>`select count(*)::text as n from orders where store_id = ${A.storeId}`)[0].n, "a refused cart wrote an order").toBe("0");
    expect(await stock(), "a refused cart moved stock").toBe(before);

    const res = await post(cart(PRICE));
    const body = (await res.json()) as {
      ok: boolean; orderNumber?: string; total?: number; buyerPayable?: number; feeMismatch?: boolean; error?: string;
    };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.orderNumber).toBeTruthy();

    const [ord] = await client<{
      id: string; status: string; financial_status: string; subtotal_idr: string; shipping_idr: string;
      tax_idr: string; discount_idr: string; total_idr: string; store_id: string;
    }[]>`select id, status::text, financial_status::text, subtotal_idr, shipping_idr, tax_idr, discount_idr, total_idr, store_id
           from orders where number = ${body.orderNumber!}`;
    orderId = ord.id;
    expect(ord.store_id).toBe(A.storeId);
    expect(ord.status).toBe("baru");
    expect(ord.financial_status).toBe("pending");
    const goods = PRICE * QTY;
    const total = goods + SHIPPING; // tax off, no voucher
    expect([Number(ord.subtotal_idr), Number(ord.shipping_idr), Number(ord.tax_idr), Number(ord.discount_idr), Number(ord.total_idr)])
      .toEqual([goods, SHIPPING, 0, 0, total]);
    const lines = await client<{ price_idr: string; qty: number; total_idr: string }[]>`
      select price_idr, qty, total_idr from order_line_items where order_id = ${ord.id}`;
    expect(lines.map((l) => [Number(l.price_idr), Number(l.qty), Number(l.total_idr)]), "the client's price leaked into the line")
      .toEqual([[PRICE, QTY, goods]]);

    // The fee, reconciled against THE SCHEDULE (`@tokophi/lib/payment-fees`, enforced 2026-08-24):
    // VA BCA is flat Rp6.500, charged to the BUYER on top of the order — never inside `total_idr`,
    // never in the seller's proceeds. The PSP's echo (`payments.admin_fee`) must agree with it.
    const fee = paymentFee("va", { omsetIdr: goods, payableIdr: total }, "VABCA");
    expect(fee).toBe(6_500);
    const [fin] = await client<{ goods_proceeds_idr: string; order_payable_idr: string; expected_gateway_fee_idr: string }[]>`
      select goods_proceeds_idr, order_payable_idr, expected_gateway_fee_idr from order_financials where order_id = ${ord.id}`;
    expect([Number(fin.goods_proceeds_idr), Number(fin.order_payable_idr), Number(fin.expected_gateway_fee_idr)]).toEqual([goods, total, fee]);
    const [pay] = await client<{
      method: string; status: string; provider: string; reff_id: string; trx_id: string | null;
      amount_idr: string; admin_fee: string; total: string; channel_code: string;
    }[]>`select method::text, status::text, provider, reff_id, trx_id, amount_idr, admin_fee, total, channel_code
           from payments where order_id = ${ord.id}`;
    expect(pay).toMatchObject({ method: "va", status: "menunggu", provider: "autolaris", reff_id: body.orderNumber, channel_code: "VABCA" });
    expect(pay.trx_id, "the gateway's trx_id was not written — the callback could never match").toBeTruthy();
    expect([Number(pay.amount_idr), Number(pay.admin_fee), Number(pay.total)]).toEqual([total, fee, total + fee]);
    expect([body.total, body.buyerPayable, body.feeMismatch]).toEqual([total, total + fee, false]);
    // Task 8.25 (a): the PSP is billed for buyerPayable — the fee the shopper agreed to, not a number
    // the provider adds afterwards.
    expect(billed.at(-1), "the PSP was billed for something other than buyerPayable").toBe(total + fee);

    // ② STOCK moved exactly once, by exactly the quantity ordered.
    expect(await stock(), "stock drift on order creation").toBe(before - QTY);
    const trx = pay.trx_id!;

    // ③ A PAID callback whose amount is not what we billed is IGNORED — nothing moves.
    expect((await callback(trx, "PAID", total - 1)).status).toBe(200);
    expect((await paymentRow(ord.id)).status, "a wrong-amount callback marked the payment paid").toBe("menunggu");
    expect(await ledger(ord.id), "a wrong-amount callback credited the sale").toEqual([]);

    // ④ PAID. One callback, and the money is booked — HELD, not withdrawable, and GOODS ONLY.
    expect((await callback(trx, "PAID", total)).status).toBe(200);
    const paid = await paymentRow(ord.id);
    expect(paid.status).toBe("berhasil");
    expect(paid.paid_at).not.toBeNull();
    expect((await orderRow(ord.id)).financial_status).toBe("dibayar");
    const credited = await ledger(ord.id);
    expect(credited, "one sale credit, pending, worth the goods — never the ongkir or the fee")
      .toEqual([{ kind: "sale", status: "pending", amount: goods, released: false }]);
    expect(await available(A.storeId)).toBe(0);

    // ⑤ REPLAY. The vendor retries; nothing may move — not the money, not the stock, not `paid_at`.
    const stockAfterPaid = await stock();
    expect((await callback(trx, "PAID", total)).status).toBe(200);
    // ABSOLUTE, not "unchanged since the last look": a snapshot comparison cannot see a duplicate the
    // FIRST callback already wrote. One order, one sale credit, ever.
    expect((await ledger(ord.id)).filter((e) => e.kind === "sale"), "more than one sale credit for one order").toHaveLength(1);
    expect(await ledger(ord.id), "a duplicate callback moved the ledger").toEqual(credited);
    expect((await paymentRow(ord.id)).paid_at?.getTime(), "a replay churned paid_at").toBe(paid.paid_at!.getTime());
    expect(await stock()).toBe(stockAfterPaid);
    // …and a late EXPIRED for a COLLECTED payment is refused: money received is not un-received by a webhook.
    expect((await callback(trx, "EXPIRED", total)).status).toBe(200);
    expect((await paymentRow(ord.id)).status, "EXPIRED walked a paid payment backwards").toBe("berhasil");
    expect((await orderRow(ord.id)).financial_status).toBe("dibayar");

    // ⑥ TRANSITIONS, through the one writer of `orders.status`, under the tenant role.
    expect(await move("diproses")).toEqual({ applied: true });
    expect(await move("dikirim")).toEqual({ applied: true });
    expect((await orderRow(ord.id)).status).toBe("dikirim");
    // The RELEASE RULE (`platform_payout.release_on`, default `selesai`): at despatch the sale is
    // still held — a parcel can only be returned after it shipped.
    expect((await ledger(ord.id))[0], "released at dikirim — a merchant could withdraw money for goods that come back")
      .toMatchObject({ kind: "sale", status: "pending", released: false });
    expect(await available(A.storeId)).toBe(0);
    expect(await move("selesai")).toEqual({ applied: true });
    expect(await ledger(ord.id), "a delivered sale becomes withdrawable")
      .toEqual([{ kind: "sale", status: "available", amount: goods, released: true }]);
    expect(await available(A.storeId)).toBe(goods);

    // ⑦ AN ILLEGAL MOVE IS REFUSED — `selesai → dikirim` would un-complete a settled order.
    expect(await move("dikirim")).toEqual({ applied: false, reason: "transition-not-allowed" });
    expect(await move("batal"), "selesai → batal would claw back cash the merchant is holding")
      .toEqual({ applied: false, reason: "transition-not-allowed" });
    expect((await orderRow(ord.id)).status).toBe("selesai");

    // ⑧ PAYOUT. The merchant withdraws part of the balance; the book, not a column, says what is left.
    const draw = 150_000;
    expect(await asTenant(A.storeId, (tx) => requestPayoutInTenant(tx, A.storeId, draw))).toMatchObject({ ok: true });
    const payouts = await client<{ status: string; amount_idr: string; bank_account: string }[]>`
      select status::text, amount_idr, bank_account from payouts where store_id = ${A.storeId}`;
    expect(payouts.map((p) => [p.status, Number(p.amount_idr), p.bank_account])).toEqual([["menunggu", draw, "1234567890"]]);
    const debit = await client<{ status: string; amount_idr: string; order_id: string | null; payout_id: string | null }[]>`
      select status::text, amount_idr, order_id, payout_id from ledger_entries where store_id = ${A.storeId} and kind = 'payout'`;
    expect(debit.map((d) => [d.status, Number(d.amount_idr), d.order_id, d.payout_id !== null])).toEqual([["available", -draw, null, true]]);
    expect(await available(A.storeId)).toBe(goods - draw);
    // A second draw over what is left is refused by the SAME sum — and books nothing.
    expect(await asTenant(A.storeId, (tx) => requestPayoutInTenant(tx, A.storeId, goods - draw + 1)))
      .toEqual({ ok: false, error: "Saldo tersedia tidak mencukupi." });
    expect((await client<{ n: string }[]>`select count(*)::text as n from payouts where store_id = ${A.storeId}`)[0].n).toBe("1");
    expect(await available(A.storeId)).toBe(goods - draw);

    // ⑨ RETURN. The parcel comes back: stock restored, the sale reversed by an OPPOSING entry, never an
    // edit. The claw-back carries the sale's status, so a return after a withdrawal leaves the book
    // NEGATIVE by what was drawn — that is the exposure the release rule accepts on `selesai → retur`,
    // and the sum must say so rather than hide it.
    const beforeReturn = await stock();
    expect(await move("retur", "Paket kembali")).toEqual({ applied: true });
    expect(await stock(), "a returned parcel did not put the goods back").toBe(beforeReturn + QTY);
    const [returned] = await client<{ status: string; return_reason: string | null }[]>`
      select status::text, return_reason from orders where id = ${ord.id}`;
    expect(returned).toEqual({ status: "retur", return_reason: "Paket kembali" });
    expect(await ledger(ord.id), "no claw-back for a returned order").toEqual([
      { kind: "sale", status: "available", amount: goods, released: true },
      { kind: "retur", status: "available", amount: -goods, released: true },
    ]);
    expect(await available(A.storeId)).toBe(goods - draw - goods);
    // Terminal: nothing leaves `retur`, and a second return cannot double-restore the stock.
    expect(await move("selesai")).toEqual({ applied: false, reason: "terminal-order" });
    expect(await move("batal")).toEqual({ applied: false, reason: "terminal-order" });
    expect(await stock()).toBe(beforeReturn + QTY);
  }, 120_000);

  // ⑩ TENANT ISOLATION, through the same GUC + role the admin's `withTenant` sets — not a bare owner query.
  it("another store can neither read nor write this store's order under RLS", async () => {
    expect(orderId, "the lifecycle test must have created the order").toBeTruthy();
    const probe = await client.begin(async (tx) => {
      await tx`select set_config('app.store_id', ${B.storeId}, true)`;
      await tx`set local role tokophi_app`;
      const [orders] = await tx<{ n: string }[]>`select count(*)::text as n from orders where store_id = ${A.storeId}`;
      const [payments] = await tx<{ n: string }[]>`select count(*)::text as n from payments where order_id = ${orderId}`;
      const [ledgerRows] = await tx<{ n: string }[]>`select count(*)::text as n from ledger_entries where store_id = ${A.storeId}`;
      const touched = await tx<{ id: string }[]>`update orders set status = 'batal' where id = ${orderId} returning id`;
      return { orders: Number(orders.n), payments: Number(payments.n), ledger: Number(ledgerRows.n), touched: touched.length };
    });
    expect(probe, "store B reached store A's rows").toEqual({ orders: 0, payments: 0, ledger: 0, touched: 0 });
    // Its own tenant still sees it — the probe above is a policy, not an empty table.
    const own = await client.begin(async (tx) => {
      await tx`select set_config('app.store_id', ${A.storeId}, true)`;
      await tx`set local role tokophi_app`;
      return tx<{ status: string }[]>`select status::text from orders where id = ${orderId}`;
    });
    expect(own.map((r) => r.status)).toEqual(["retur"]);
    // …and B's balance is B's alone: A's withdrawable sum never leaks into another store's payout.
    expect(await asTenant(B.storeId, (tx) => requestPayoutInTenant(tx, B.storeId, 50_000)))
      .toEqual({ ok: false, error: "Saldo tersedia tidak mencukupi." });
  });
});
