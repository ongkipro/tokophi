import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Mengantar Partner Business API — the operator reconciliation, against REAL Postgres with a fake
// provider: release of an `unknown` booking adopts only what a verified pull WITH THE STORE'S OWN KEY
// returns (and only for THIS order), or fails it; reason required; one operator wins. (Pay-unpaid moved
// to the Seller — the store's own wallet — and is tested in apps/admin/lib/mengantar-shipping.test.ts.)
const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
if (URL_) process.env.DATABASE_URL = URL_;
const runId = randomUUID().slice(0, 8);
const STORE_KEY = `store-key-${runId}`;

let client: Sql;
let ops: typeof import("./mengantar-ops");
let accountId = "";
let storeId = "";
const logs: { storeId: string; text: string }[] = [];

type Handler = (path: string, body: unknown) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
function provider(h: { track?: Handler } = {}) {
  const calls: { method: string; path: string; body: unknown; key: string }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/public\/[^/]+/, "") + u.search;
    const key = decodeURIComponent(/^\/api\/public\/([^/]+)/.exec(u.pathname)?.[1] ?? "");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", path, body, key });
    const out: { status?: number; body: unknown } = await (h.track ?? (() => ({ body: { success: true, data: [] } })))(path, body);
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { calls, deps: { log: async (s: string, text: string) => void logs.push({ storeId: s, text }), fetch } };
}

let seq = 0;

async function unknownBooking(debit = 0) {
  const n = `OPS-${runId}-${++seq}`;
  const [o] = await client<{ id: string }[]>`
    insert into orders (store_id, number, status, shipping_provider, courier, service_type)
    values (${storeId}, ${n}, 'baru'::order_status, 'mengantar', 'jne', 'JNE') returning id`;
  const [b] = await client<{ id: string }[]>`
    insert into shipment_bookings (store_id, order_id, provider_reference, courier, service_type, service_name, status, seller_debit_idr)
    values (${storeId}, ${o.id}, ${`mg:${n}:0`}, 'jne', 'JNE', 'JNE', 'unknown'::shipment_booking_status, ${debit}) returning id`;
  if (debit) {
    await client`
      insert into ledger_entries (store_id, order_id, shipment_booking_id, component, kind, status, amount_idr, note)
      values (${storeId}, ${o.id}, ${b.id}, 'shipping-order-debit', 'adjustment'::ledger_kind, 'pending'::ledger_status, ${-debit}, 'test')`;
  }
  return { number: n, orderId: o.id, bookingId: b.id };
}
const booking = async (id: string) => (await client<{ status: string; provider_booking_id: string | null }[]>`select status, provider_booking_id from shipment_bookings where id = ${id}`)[0];

beforeAll(async () => {
  if (!URL_) return;
  process.env.INTEGRATION_TOKEN_KEY ??= "test-integration-key-not-a-secret-0001";
  delete process.env.MENGANTAR_ENV;
  client = postgres(URL_, { max: 3, onnotice: () => {} });
  ops = await import("./mengantar-ops");
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`OPS ${runId}`}) returning id`;
  accountId = acc.id;
  const [st] = await client<{ id: string }[]>`insert into stores (account_id, name, slug, status, approved_at) values (${accountId}, ${`OPS ${runId}`}, ${`ops-${runId}`}, 'active', now()) returning id`;
  storeId = st.id;
  // The store's own connected seller account — the ONLY key a reconcile may pull with.
  const { encryptSecret } = await import("@tokophi/lib/crypto");
  const { mengantarKeyScope } = await import("@tokophi/db/mengantar-account");
  await client`
    insert into store_mengantar_accounts (store_id, env, external_user_id, seller_id, state, api_key_enc, key_version)
    values (${storeId}, 'sandbox', ${`tokophi:sandbox:store:${storeId}`}, ${`ops-seller-${runId}`}, 'connected', ${encryptSecret(STORE_KEY, mengantarKeyScope(storeId, "sandbox", `ops-seller-${runId}`, 1))}, 1)`;
});

const tidy = async (q: () => Promise<unknown>) => {
  try {
    await q();
  } catch (e) {
    console.warn("[mengantar-ops.test] cleanup left a row:", e instanceof Error ? e.message : e);
  }
};
afterAll(async () => {
  if (!client) return;
  try {
    await tidy(() => client`delete from ledger_entries where store_id = ${storeId}`);
    await tidy(() => client`delete from shipment_bookings where store_id = ${storeId}`);
    await tidy(() => client`delete from orders where store_id = ${storeId}`);
    await tidy(() => client`delete from invoices where store_id = ${storeId}`);
    await tidy(() => client`delete from platform_activity where store_id = ${storeId}`);
    await tidy(() => client`delete from store_mengantar_accounts where store_id = ${storeId}`);
    await tidy(() => client`delete from stores where id = ${storeId}`);
    await tidy(() => client`delete from accounts where id = ${accountId}`);
  } finally {
    await client.end();
  }
});

suite("release of an `unknown` booking", () => {
  const row = (n: string, over: Record<string, unknown> = {}) => ({ _id: `adopt-${n}`, ORDER_ID: `MGO-A-${n}`, batch_id: `b-${n}`, cnote_no: `JNEA${n}`, isPaid: true, destinationMark: n, ...over });

  it("requires a reason and exactly one choice", async () => {
    const b = await unknownBooking();
    const p = provider();
    expect((await ops.reconcileUnknownBookingWith(p.deps, "o@test.invalid", b.bookingId, { notAtProvider: true, reason: "pendek" })).ok).toBe(false);
    expect((await ops.reconcileUnknownBookingWith(p.deps, "o@test.invalid", b.bookingId, { reason: "alasan cukup panjang" })).ok).toBe(false);
    expect((await ops.reconcileUnknownBookingWith(p.deps, "o@test.invalid", b.bookingId, { reference: "X", notAtProvider: true, reason: "alasan cukup panjang" })).ok).toBe(false);
    expect((await booking(b.bookingId)).status).toBe("unknown");
    expect(p.calls).toHaveLength(0);
  });

  it("not at the provider → failed (no ledger debit exists under the partner model); a second operator finds nothing to do", async () => {
    const b = await unknownBooking();
    const p = provider();
    const input = { notAtProvider: true, reason: "dicari di dashboard, tidak ada" };
    const [x, y] = await Promise.all([
      ops.reconcileUnknownBookingWith(p.deps, "o1@test.invalid", b.bookingId, input),
      ops.reconcileUnknownBookingWith(p.deps, "o2@test.invalid", b.bookingId, input),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect((await booking(b.bookingId)).status).toBe("failed");
    expect(await client`select 1 from ledger_entries where shipment_booking_id = ${b.bookingId}`).toHaveLength(0);
    expect(logs.some((l) => l.text.includes(b.number) && /DILEPAS oleh o[12]@test\.invalid/.test(l.text))).toBe(true);
  });

  it("adopt: the mg_* and waybill come from the verified pull, made with THE STORE'S OWN key", async () => {
    const b = await unknownBooking();
    const p = provider({ track: (path) => ({ body: { success: true, data: path.includes("order_id=MGO-A") ? [row(b.number)] : [] } }) });
    const r = await ops.reconcileUnknownBookingWith(p.deps, "o@test.invalid", b.bookingId, { reference: `MGO-A-${b.number}`, reason: "ditemukan di dashboard provider" });
    expect(r.ok).toBe(true);
    expect(await booking(b.bookingId)).toEqual({ status: "accepted", provider_booking_id: `adopt-${b.number}` });
    const [o] = await client`select mg_order_id, mg_order_code, mg_batch_id, mg_is_paid, mg_courier, awb, status, mg_env, mg_seller_id from orders where id = ${b.orderId}`;
    expect(o).toMatchObject({ mg_order_id: `adopt-${b.number}`, mg_order_code: `MGO-A-${b.number}`, mg_batch_id: `b-${b.number}`, mg_is_paid: true, mg_courier: "JNE", awb: `JNEA${b.number}`, status: "baru", mg_env: "sandbox", mg_seller_id: `ops-seller-${runId}` });
    expect(p.calls.every((c) => c.key === STORE_KEY)).toBe(true);
  });

  it("refuses to adopt a shipment the provider says belongs to ANOTHER order, or one it does not have", async () => {
    const b = await unknownBooking();
    const other = provider({ track: () => ({ body: { success: true, data: [row(b.number, { ORDER_ID: "MGO-X", destinationMark: "INV-SOMEONE-ELSE" })] } }) });
    const r1 = await ops.reconcileUnknownBookingWith(other.deps, "o@test.invalid", b.bookingId, { reference: "MGO-X", reason: "alasan cukup panjang" });
    expect(r1.ok).toBe(false);
    expect(r1.message).toMatch(/milik pesanan INV-SOMEONE-ELSE/);
    const none = provider();
    const r2 = await ops.reconcileUnknownBookingWith(none.deps, "o@test.invalid", b.bookingId, { reference: "MGO-Y", reason: "alasan cukup panjang" });
    expect(r2.ok).toBe(false);
    expect(none.calls.map((c) => c.path)).toEqual(["/order?order_id=MGO-Y", "/order?tracking_id=MGO-Y"]);
    expect((await booking(b.bookingId)).status).toBe("unknown");
  });
});

suite("stranded Mengantar orders — the operator sees what no account can serve", () => {
  const order = async (sid: string, n: string, over: { status?: string; mgOrderId?: string | null; mgSeller?: string | null } = {}) =>
    client`insert into orders (store_id, number, status, shipping_provider, courier, service_type, mg_order_id, mg_seller_id, mg_env)
           values (${sid}, ${n}, ${over.status ?? "diproses"}::order_status, 'mengantar', 'jne', 'JNE', ${over.mgOrderId ?? null}, ${over.mgSeller ?? null}, ${over.mgOrderId ? "sandbox" : null})`;

  it("lists blocked / missing / seller-changed accounts; never a healthy one or a finished order", async () => {
    const mine = (rows: { orderNumber: string }[]) => rows.filter((r) => r.orderNumber.startsWith(`STR-${runId}`)).map((r) => r.orderNumber).sort();
    // Healthy store (the suite's connected account): unbooked + booked-by-this-seller → not stranded.
    await order(storeId, `STR-${runId}-ok-unbooked`);
    await order(storeId, `STR-${runId}-ok-booked`, { mgOrderId: `m-${runId}-1`, mgSeller: `ops-seller-${runId}` });
    // Same store, booked by a seller account it no longer holds.
    await order(storeId, `STR-${runId}-old-seller`, { mgOrderId: `m-${runId}-2`, mgSeller: "some-old-seller" });
    // Finished orders never show.
    await order(storeId, `STR-${runId}-done`, { status: "selesai", mgOrderId: `m-${runId}-3`, mgSeller: "some-old-seller" });
    const rows = await ops.listStrandedMengantar("sandbox");
    expect(mine(rows)).toEqual([`STR-${runId}-old-seller`]);
    expect(rows.find((r) => r.orderNumber === `STR-${runId}-old-seller`)).toMatchObject({ booked: true, sellerChanged: true, accountState: "connected" });

    // The store's account gets blocked → its unbooked AND booked orders are stranded.
    await client`update store_mengantar_accounts set state = 'blocked' where store_id = ${storeId} and env = 'sandbox'`;
    try {
      const blocked = await ops.listStrandedMengantar("sandbox");
      expect(mine(blocked)).toEqual([`STR-${runId}-ok-booked`, `STR-${runId}-ok-unbooked`, `STR-${runId}-old-seller`].sort());
      expect(blocked.find((r) => r.orderNumber === `STR-${runId}-ok-unbooked`)).toMatchObject({ booked: false, accountState: "blocked", sellerChanged: false });
    } finally {
      await client`update store_mengantar_accounts set state = 'connected' where store_id = ${storeId} and env = 'sandbox'`;
    }
  });
});
