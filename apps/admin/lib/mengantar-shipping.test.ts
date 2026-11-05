import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MengantarConfig } from "@tokophi/lib/provider-config";

// Mengantar Partner Business API — booking, claim, outcome-unknown, cancel, tracking and "Bayar ongkir"
// against REAL Postgres, each store with ITS OWN sealed seller account (`store_mengantar_accounts`).
//
// Every provider call goes through a FAKE `fetch` injected per call: the client refuses any write
// under NODE_ENV=test without one (`assertWriteAllowed`), so nothing here reaches Mengantar. The fake
// records WHICH seller key each call carried, so "the order's own account" is asserted, not assumed.
// Rows are committed by the code under test, so the suite seeds under a run id and deletes what it made.
const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);

let client: Sql;
let mod: typeof import("./mengantar-shipping");
let trk: typeof import("./mengantar-tracking");
let accountId = "";
const storeIds: string[] = [];
let crypto_: typeof import("@tokophi/lib/crypto");
let acct: typeof import("@tokophi/db/mengantar-account");
/** The seller key sealed for each store — what every provider call for that store must carry. */
const keyOf = new Map<string, string>();
const sellerOf = new Map<string, string>();
let platformCourierId = "";
const DISTRICT = 9_000_000 + Math.floor(Math.random() * 900_000);
const DIST_AREA = randomUUID().replace(/-/g, "").slice(0, 24);
const ORIGIN_AREA = randomUUID().replace(/-/g, "").slice(0, 24);
const CFG: MengantarConfig = { env: "sandbox", base: "https://mg.test.invalid", key: "fake-key-not-a-secret" };

type Call = { method: string; path: string; body: unknown; key: string };
type Handler = (c: Call) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

/** A provider stand-in: records every call, answers the read/plumbing endpoints, delegates the rest. */
function fakeProvider(over: { createOrder?: Handler; cancel?: Handler; track?: Handler; slots?: Handler; pay?: Handler; address?: Handler } = {}) {
  const calls: Call[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = decodeURIComponent(/^\/api\/public\/([^/]+)/.exec(u.pathname)?.[1] ?? "");
    const path = u.pathname.replace(/^\/api\/public\/[^/]+/, "") + u.search;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (init.headers as Record<string, string>)["Content-Type"]?.includes("json") ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body)) : undefined;
    const c: Call = { method, path, body, key };
    calls.push(c);
    let out: { status?: number; body: unknown };
    if (method === "GET" && path.startsWith("/order/estimate")) {
      out = { body: { success: true, data: { JNE: { price: 18000, estimatedSpecialPrice: 15000 }, JT: { price: 17000 } } } };
    } else if (path === "/address" && method === "POST") {
      out = await (over.address ?? (() => ({ body: { success: true, data: { _id: "addr0000000000000000000a" } } })))(c);
    } else if (path.startsWith("/time") && method === "GET") {
      out = await (over.slots ?? (() => ({ body: { success: true, data: [] } })))(c);
    } else if (path === "/time" && method === "POST") {
      out = { body: { success: true, data: { _id: "slot0000000000000000000a" } } };
    } else if (path === "/order" && method === "POST") {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        out = await (over.createOrder ?? okCreate())(c);
      } finally {
        inFlight--;
      }
    } else if (path === "/order/pay-unpaid" && method === "POST") {
      out = await (over.pay ?? (() => ({ body: { success: true, data: 1, cnote_no: [] } })))(c);
    } else if (path === "/order" && method === "DELETE") {
      out = await (over.cancel ?? (() => ({ body: { success: true, deletedCount: 1 } })))(c);
    } else if (path.startsWith("/order?")) {
      out = await (over.track ?? (() => ({ body: { success: true, data: [] } })))(c);
    } else {
      out = { status: 404, body: { success: false, message: `unexpected ${method} ${path}` } };
    }
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, posts: () => calls.filter((c) => c.method === "POST" && c.path === "/order"), maxInFlight: () => maxInFlight };
}

let created = 0;
function okCreate(over: { cnote?: string | null; isPaid?: boolean; delayMs?: number } = {}): Handler {
  return async () => {
    if (over.delayMs) await new Promise((r) => setTimeout(r, over.delayMs));
    const n = ++created;
    return {
      body: {
        success: true,
        batch_id: `batch-${runId}-${n}`,
        data: [{ _id: `mgid-${runId}-${n}`, ORDER_ID: `MGO-${runId}-${n}`, cnote_no: over.cnote === undefined ? null : over.cnote, isPaid: over.isPaid ?? true }],
      },
    };
  };
}

/** Seal a connected seller account for `storeId` exactly as `connectStoreMengantar` would. */
async function sealAccount(storeId: string, opts: { pickupId?: string | null; version?: number; key?: string; state?: string } = {}) {
  const seller = sellerOf.get(storeId) ?? `seller-${storeId.slice(0, 8)}`;
  const v = opts.version ?? 1;
  const key = opts.key ?? `key-${storeId.slice(0, 8)}-v${v}`;
  const enc = crypto_.encryptSecret(key, acct.mengantarKeyScope(storeId, "sandbox", seller, v));
  await client`
    insert into store_mengantar_accounts (store_id, env, external_user_id, seller_id, state, api_key_enc, key_hint, key_version, pickup_address_id)
    values (${storeId}, 'sandbox', ${`tokophi:sandbox:store:${storeId}`}, ${seller}, ${opts.state ?? "connected"}, ${enc}, ${key.slice(-4)}, ${v}, ${opts.pickupId === undefined ? "addr-preset" : opts.pickupId})
    on conflict (store_id, env) do update set seller_id = excluded.seller_id, state = excluded.state, api_key_enc = excluded.api_key_enc, key_version = excluded.key_version, pickup_address_id = excluded.pickup_address_id`;
  keyOf.set(storeId, key);
  sellerOf.set(storeId, seller);
}

async function newStore(opts: { pickupId?: string | null; connected?: boolean } = {}) {
  const [st] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status, approved_at)
    values (${accountId}, ${`MG ${runId}`}, ${`mg-${runId}-${storeIds.length}`}, 'active', now()) returning id`;
  storeIds.push(st.id);
  await client`
    insert into store_settings (store_id, sender_name, sender_phone, sender_address, sender_kecamatan_id, sender_kecamatan_name, sender_mengantar_area_id)
    values (${st.id}, 'Gudang Uji', '6281200000000', 'Jl. Uji 1', ${DISTRICT}, 'Uji', ${ORIGIN_AREA})`;
  if (opts.connected !== false) await sealAccount(st.id, { pickupId: opts.pickupId });
  return st.id;
}

let seq = 0;
async function newOrder(storeId: string, opts: { cod?: boolean; provider?: string | null; status?: string; mg?: { id: string; code: string; courier: string; awb?: string | null; booking?: string } } = {}) {
  const number = `MG-${runId}-${++seq}`;
  const [o] = await client<{ id: string }[]>`
    insert into orders (store_id, number, status, subtotal_idr, shipping_idr, total_idr, courier, service_type, shipping_provider,
                        ship_recipient, ship_phone, ship_address, ship_district_id, ship_mengantar_area_id,
                        mg_order_id, mg_order_code, mg_courier, awb, mg_env, mg_seller_id)
    values (${storeId}, ${number}, ${opts.status ?? "baru"}::order_status, 100000, 18000, 118000, 'jne', 'JNE',
            ${opts.provider === undefined ? "mengantar" : opts.provider},
            'Budi', '6281300000000', 'Jl. Tujuan 2', ${DISTRICT}, ${DIST_AREA},
            ${opts.mg?.id ?? null}, ${opts.mg?.code ?? null}, ${opts.mg?.courier ?? null}, ${opts.mg?.awb ?? null},
            ${opts.mg ? "sandbox" : null}, ${opts.mg ? (sellerOf.get(storeId) ?? null) : null})
    returning id`;
  await client`insert into order_line_items (order_id, title, qty, price_idr, total_idr) values (${o.id}, 'Kemeja', 2, 50000, 100000)`;
  await client`
    insert into payments (order_id, store_id, method, amount_idr, status, paid_at)
    values (${o.id}, ${storeId}, ${opts.cod ? "cod" : "transfer"}::payment_method, 118000, ${opts.cod ? "menunggu" : "berhasil"}::payment_status, now())`;
  if (opts.mg?.booking) {
    await client`
      insert into shipment_bookings (store_id, order_id, provider_reference, provider_booking_id, courier, service_type, service_name, status, accepted_at)
      values (${storeId}, ${o.id}, ${`mg:${number}:0`}, ${opts.mg.id}, 'jne', 'JNE', 'JNE', ${opts.mg.booking}::shipment_booking_status, now())`;
  }
  return { id: o.id, number };
}

const order = async (id: string) =>
  (
    await client<
      { status: string; awb: string | null; mg_order_id: string | null; mg_order_code: string | null; mg_batch_id: string | null; mg_is_paid: boolean | null; mg_courier: string | null; problem_at: Date | null }[]
    >`select status, awb, mg_order_id, mg_order_code, mg_batch_id, mg_is_paid, mg_courier, problem_at from orders where id = ${id}`
  )[0];
const bookings = async (orderId: string) => client<{ status: string; provider_booking_id: string | null }[]>`select status, provider_booking_id from shipment_bookings where order_id = ${orderId} order by created_at`;

const opts = (fetch: typeof globalThis.fetch) => ({ fetch, retry409Ms: [5, 5], pickupMode: "scheduledPickup" as const });
/** For the pure pull helpers, which take an already-opened account. */
const pullOpts = (fetch: typeof globalThis.fetch) => ({ fetch, cfg: CFG });
const book = (storeId: string, number: string, fetch: typeof globalThis.fetch, cost?: number) =>
  mod.bookMengantar(storeId, { orderNumber: number, service: "jne", serviceType: "JNE", serviceName: "JNE", cost }, opts(fetch));

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  process.env.INTEGRATION_TOKEN_KEY ??= "test-integration-key-not-a-secret-0001";
  delete process.env.MENGANTAR_ENV; // sandbox — the accounts below are sealed for it
  client = postgres(URL_, { max: 4, onnotice: () => {} });
  crypto_ = await import("@tokophi/lib/crypto");
  acct = await import("@tokophi/db/mengantar-account");
  mod = await import("./mengantar-shipping");
  trk = await import("./mengantar-tracking");
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`MG ${runId}`}) returning id`;
  accountId = acc.id;
  await client`insert into kiriminaja_areas (id, district_name, city_name, province_name, mengantar_area_id) values (${DISTRICT}, 'Uji', 'Kota Uji', 'Uji', ${DIST_AREA})`;
  const [pc] = await client<{ id: string }[]>`insert into platform_couriers (courier, enabled) values ('jne', true) returning id`;
  platformCourierId = pc.id;
});

// ⚠️ CLEANUP NEVER FAILS THE FILE. The `_test` DB is shared by every suite running in parallel, and
// some of them sweep ALL stores (the billing cron invoices every active store; others may attach rows
// we did not create). A foreign-key error here used to surface as a FILE-LEVEL error after every test
// had passed (2026-11-05). Each step is tried on its own and a leftover row in a throwaway DB is
// logged, never thrown.
const tidy = async (what: string, q: () => Promise<unknown>) => {
  try {
    await q();
  } catch (e) {
    console.warn(`[mengantar-shipping.test] cleanup left ${what}:`, e instanceof Error ? e.message : e);
  }
};

afterAll(async () => {
  if (!client) return;
  try {
    for (const s of storeIds) {
      await tidy("ledger", () => client`delete from ledger_entries where store_id = ${s}`);
      await tidy("bookings", () => client`delete from shipment_bookings where store_id = ${s}`);
      await tidy("payments", () => client`delete from payments where store_id = ${s}`);
      await tidy("lines", () => client`delete from order_line_items where order_id in (select id from orders where store_id = ${s})`);
      await tidy("orders", () => client`delete from orders where store_id = ${s}`);
      await tidy("settings", () => client`delete from store_settings where store_id = ${s}`);
      await tidy("mg account", () => client`delete from store_mengantar_accounts where store_id = ${s}`);
      await tidy("invoices", () => client`delete from invoices where store_id = ${s}`);
      await tidy("activity", () => client`delete from platform_activity where store_id = ${s}`);
      await tidy(`store ${s}`, () => client`delete from stores where id = ${s}`);
    }
    await tidy("account", () => client`delete from accounts where id = ${accountId}`);
    await tidy("courier", () => client`delete from platform_couriers where id = ${platformCourierId}`);
    await tidy("district", () => client`delete from kiriminaja_areas where id = ${DISTRICT}`);
  } finally {
    await client.end();
  }
});

suite("bookMengantar — the exactly-once claim", () => {
  it("two simultaneous clicks on one order send ONE POST /order", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider({ createOrder: okCreate({ delayMs: 150 }) });
    const [a, b] = await Promise.all([book(store, o.number, p.fetch), book(store, o.number, p.fetch)]);
    expect(p.posts()).toHaveLength(1);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.error).toMatch(/sudah dibooking|sedang atau sudah/);
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["accepted"]);
  });

  it("a booked order is refused before any provider call", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider();
    expect((await book(store, o.number, p.fetch)).ok).toBe(true);
    const before = p.calls.length;
    const again = await book(store, o.number, p.fetch);
    expect(again.ok).toBe(false);
    expect(p.calls.length).toBe(before);
  });
});

suite("bookMengantar — outcome unknown blocks the order", () => {
  it("a dropped connection on POST /order leaves the booking `unknown` and refuses every re-book", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider({ createOrder: () => Promise.reject(new TypeError("socket hang up")) });
    const r = await book(store, o.number, p.fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/belum diketahui/);
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["unknown"]);
    const row = await order(o.id);
    expect(row.mg_order_id).toBeNull();
    expect(row.awb).toBeNull();

    // The retry: a healthy provider now — and still no second POST /order.
    const healthy = fakeProvider();
    const again = await book(store, o.number, healthy.fetch);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/belum diketahui/);
    expect(healthy.posts()).toHaveLength(0);
  });

  it("a 5xx is outcome-unknown too (the shipment may exist)", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider({ createOrder: () => ({ status: 502, body: { success: false, message: "bad gateway" } }) });
    expect((await book(store, o.number, p.fetch)).ok).toBe(false);
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["unknown"]);
  });

  it("a business refusal (JSON 4xx) is NOT unknown: booking failed, re-book allowed", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider({ createOrder: () => ({ status: 400, body: { success: false, message: "alamat tidak valid" } }) });
    const r = await book(store, o.number, p.fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/alamat tidak valid/);
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["failed"]);
    expect((await book(store, o.number, fakeProvider().fetch)).ok).toBe(true);
  });
});

suite("bookMengantar — what is stored, and what is NOT", () => {
  it("stores the provider ids from the answer; a waybill at booking does NOT make the order `dikirim`", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider({ createOrder: okCreate({ cnote: "JNE000123" }) });
    const r = await book(store, o.number, p.fetch);
    expect(r).toMatchObject({ ok: true, awb: "JNE000123", awbPending: false });
    const row = await order(o.id);
    expect(row).toMatchObject({ status: "diproses", awb: "JNE000123", mg_is_paid: true, mg_courier: "JNE" });
    expect(row.mg_order_id).toMatch(/^mgid-/);
    expect(row.mg_order_code).toMatch(/^MGO-/);
    // The payload: our order number as the only marker, the whole order's kg (2 × 500 g default → 1 kg floor).
    const sent = p.posts()[0].body as { courier: string; pickup: { type: string; address_id: string; time_id: string }; orders: Record<string, unknown>[] };
    expect(sent.courier).toBe("JNE");
    expect(sent.pickup).toEqual({ type: "scheduledPickup", address_id: "addr-preset", time_id: "slot0000000000000000000a", volume: "volumeMotor" });
    expect(sent.orders[0]).toMatchObject({ destinationMark: o.number, customerAddressDataId: DIST_AREA, weight: 1, quantity: 2, goodsValue: 100000 });
    expect(sent.orders[0]).not.toHaveProperty("COD");
  });

  it("an UNPAID booking (the store's Mengantar wallet was short) is stored as booked-but-unpaid with no waybill", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const r = await book(store, o.number, fakeProvider({ createOrder: okCreate({ isPaid: false, cnote: null }) }).fetch);
    expect(r).toMatchObject({ ok: true, awb: null, awbPending: true });
    expect(await order(o.id)).toMatchObject({ status: "diproses", awb: null, mg_is_paid: false });
  });

  it("never stores the provider's own id as the waybill", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider({
      createOrder: () => ({ body: { success: true, data: [{ _id: `echo-${runId}`, ORDER_ID: `echo-code-${runId}`, cnote_no: `echo-${runId}`, isPaid: true }] } }),
    });
    expect((await book(store, o.number, p.fetch)).awb).toBeNull();
    expect((await order(o.id)).awb).toBeNull();
  });

  it("refuses a COD order before ANY provider call (COD never travels Mengantar, O4/O6)", async () => {
    const store = await newStore();
    const o = await newOrder(store, { cod: true });
    const p = fakeProvider();
    const r = await book(store, o.number, p.fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/COD/);
    expect(p.calls).toHaveLength(0);
  });

  it("refuses a stale price (the seller's screen showed a different cost)", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider();
    const r = await book(store, o.number, p.fetch, 15000);
    expect(r.error).toMatch(/Tarif berubah/);
    expect(p.posts()).toHaveLength(0);
  });

  it("registers the store's pickup address ONCE and books against the stored id", async () => {
    const store = await newStore({ pickupId: null });
    const a = await newOrder(store);
    const b = await newOrder(store);
    const p = fakeProvider();
    expect((await book(store, a.number, p.fetch)).ok).toBe(true);
    expect((await book(store, b.number, p.fetch)).ok).toBe(true);
    expect(p.calls.filter((c) => c.method === "POST" && c.path === "/address")).toHaveLength(1);
    // Stored on THIS seller account's row (a sandbox address never reaches production).
    const [s] = await client<{ id: string | null }[]>`select pickup_address_id as id from store_mengantar_accounts where store_id = ${store} and env = 'sandbox'`;
    expect(s.id).toBe("addr0000000000000000000a");
    expect(p.posts().map((c) => (c.body as { pickup: { address_id: string } }).pickup.address_id)).toEqual(["addr0000000000000000000a", "addr0000000000000000000a"]);
  });

  it("a sender address saved WHILE the old one is being registered never lets the old door stick", async () => {
    const store = await newStore({ pickupId: null });
    const a = await newOrder(store);
    const p = fakeProvider({
      address: async () => {
        // The seller saves a new pickup address mid-flight (saveSenderAddress: new fields + slot cleared).
        await client`update store_settings set sender_address = ${`Jl. Baru ${runId}`} where store_id = ${store}`;
        return { body: { success: true, data: { _id: "addr-stale-000000000000a" } } };
      },
    });
    const r = await book(store, a.number, p.fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tidak tersimpan/);
    expect(p.posts()).toHaveLength(0);
    const [row] = await client<{ id: string | null }[]>`select pickup_address_id as id from store_mengantar_accounts where store_id = ${store} and env = 'sandbox'`;
    expect(row.id).toBeNull();
    // The next attempt registers the NEW address and books.
    const fresh = fakeProvider();
    expect((await book(store, a.number, fresh.fetch)).ok).toBe(true);
    expect(fresh.calls.filter((c) => c.method === "POST" && c.path === "/address")).toHaveLength(1);
  });
});

suite("bookMengantar — the per-seller-account lease and 409", () => {
  it("two orders of ONE store never have two POST /order in flight (the 409 is per account)", async () => {
    const s1 = await newStore();
    const o1 = await newOrder(s1);
    const o2 = await newOrder(s1);
    const p = fakeProvider({ createOrder: okCreate({ delayMs: 120 }) });
    const [a, b] = await Promise.all([book(s1, o1.number, p.fetch), book(s1, o2.number, p.fetch)]);
    expect(a.ok && b.ok).toBe(true);
    expect(p.posts()).toHaveLength(2);
    expect(p.maxInFlight()).toBe(1);
  });

  it("two STORES are separate accounts: their bookings may run side by side", async () => {
    const s1 = await newStore();
    const s2 = await newStore();
    const o1 = await newOrder(s1);
    const o2 = await newOrder(s2);
    const p = fakeProvider({ createOrder: okCreate({ delayMs: 200 }) });
    const [a, b] = await Promise.all([book(s1, o1.number, p.fetch), book(s2, o2.number, p.fetch)]);
    expect(a.ok && b.ok).toBe(true);
    expect(p.maxInFlight()).toBe(2);
  });

  it("a 409 (another create in flight on the seller's account) is retried, and books once", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    let first = true;
    const ok = okCreate();
    const p = fakeProvider({
      createOrder: (c) => {
        if (first) {
          first = false;
          return { status: 409, body: { success: false, message: "Order sedang diproses" } };
        }
        return ok(c);
      },
    });
    expect((await book(store, o.number, p.fetch)).ok).toBe(true);
    expect(p.posts()).toHaveLength(2);
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["accepted"]);
  });
});

suite("bookMengantar — the pickup slot comes from the provider's own schedule", () => {
  const mmddyyyy = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-");
    return `${p[1]}-${p[2]}-${p[0]}`;
  };

  it("reuses the earliest listed slot that is still ≥ 90 min away — no POST /time — and tells the seller when", async () => {
    const store = await newStore({ pickupId: `addr-${randomUUID().slice(0, 8)}` });
    const o = await newOrder(store);
    const in3d = new Date(Date.now() + 3 * 864e5);
    const in2d = new Date(Date.now() + 2 * 864e5);
    const p = fakeProvider({
      slots: () => ({
        body: {
          success: true,
          data: [
            { _id: "slot-far", date: mmddyyyy(in3d), time: "10:00" },
            { _id: "slot-near", date: mmddyyyy(in2d), time: "9:00" },
            { _id: "slot-past", date: mmddyyyy(new Date(Date.now() - 864e5)), time: "10:00" },
          ],
        },
      }),
    });
    const r = await book(store, o.number, p.fetch);
    expect(r.ok).toBe(true);
    expect((p.posts()[0].body as { pickup: { time_id: string } }).pickup.time_id).toBe("slot-near");
    expect(p.calls.some((c) => c.method === "POST" && c.path === "/time")).toBe(false);
    expect(r.pickupAt).toMatch(/pukul 09[.:]00 WIB$/);
  });

  it("no usable slot listed → creates the earliest one the provider's rule allows", async () => {
    const store = await newStore({ pickupId: `addr-${randomUUID().slice(0, 8)}` });
    const o = await newOrder(store);
    const p = fakeProvider();
    const r = await book(store, o.number, p.fetch);
    expect(r.ok).toBe(true);
    const post = p.calls.find((c) => c.method === "POST" && c.path === "/time");
    expect(post?.body).toMatchObject({ time: expect.stringMatching(/^(9|1[0-8]):00$/) });
    expect(r.pickupAt).toBeTruthy();
  });

  it("the schedule cannot be read → refused with a seller message, nothing reserved, no POST /order", async () => {
    const store = await newStore({ pickupId: `addr-${randomUUID().slice(0, 8)}` });
    const o = await newOrder(store);
    const p = fakeProvider({ slots: () => ({ status: 400, body: { success: false, message: "address not found" } }) });
    const r = await book(store, o.number, p.fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Jadwal penjemputan kurir tidak bisa dibaca/);
    expect(p.posts()).toHaveLength(0);
    expect(p.calls.some((c) => c.method === "POST" && c.path === "/time")).toBe(false);
    expect(await bookings(o.id)).toHaveLength(0);
  });
});

suite("cancelMengantar", () => {
  it("nothing booked → refused, no provider call", async () => {
    const store = await newStore();
    const o = await newOrder(store);
    const p = fakeProvider();
    const r = await mod.cancelMengantar(store, o.number, opts(p.fetch));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/belum punya pengiriman/);
    expect(p.calls).toHaveLength(0);
  });

  it("DELETE /order by the provider _id + booking courier; a confirmed deletedCount voids the booking at once (the deleted order vanishes from tracking — sandbox E2E 2026-11-05)", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: `c1-${runId}`, code: `C1-${runId}`, courier: "JNE", booking: "accepted" } });
    const p = fakeProvider();
    const r = await mod.cancelMengantar(store, o.number, opts(p.fetch));
    expect(r).toEqual({ ok: true });
    const del = p.calls.filter((c) => c.method === "DELETE");
    expect(del).toHaveLength(1);
    expect(del[0].body).toEqual({ courier: "JNE", ids: [`c1-${runId}`] });
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["voided"]);
    expect(await order(o.id)).toMatchObject({ status: "diproses", mg_order_id: null, mg_order_code: null });
    // A second click finds nothing booked and sends nothing.
    const again = await mod.cancelMengantar(store, o.number, opts(p.fetch));
    expect(again.ok).toBe(false);
    expect(p.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("an outcome-unknown DELETE (no readable deletedCount) stays pending for tracking — never voided on a guess", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: `c4-${runId}`, code: `C4-${runId}`, courier: "JNE", booking: "accepted" } });
    const p = fakeProvider({ cancel: () => ({ body: { success: true } }) });
    const r = await mod.cancelMengantar(store, o.number, opts(p.fetch));
    expect(r.ok).toBe(false);
    expect(r.pending).toBe(true);
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["cancellation_requested"]);
  });

  it("a provider refusal for a shipment that still EXISTS puts the booking back to accepted", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: `c2-${runId}`, code: `C2-${runId}`, courier: "anteraja", booking: "accepted" } });
    const p = fakeProvider({
      cancel: () => ({ status: 400, body: { success: false, message: "Anteraja hanya bisa dibatalkan setelah 5 menit" } }),
      track: () => ({ body: { success: true, data: [{ ORDER_ID: `C2-${runId}`, cnote_no: null, status: JSON.stringify({ "PENDING PICKUP": true }) }] } }),
    });
    const r = await mod.cancelMengantar(store, o.number, opts(p.fetch));
    expect(r.ok).toBe(false);
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["accepted"]);
    expect(await order(o.id)).toMatchObject({ mg_order_id: `c2-${runId}` });
  });

  it("a refusal for a shipment the seller already DELETED in Mengantar (read-back: not found) closes it as a void — re-bookable, not stuck", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: `c5-${runId}`, code: `C5-${runId}`, courier: "JT", booking: "accepted" } });
    const p = fakeProvider({ cancel: () => ({ body: { success: true, deletedCount: 0 } }) }); // default track: not found
    const r = await mod.cancelMengantar(store, o.number, opts(p.fetch));
    expect(r).toEqual({ ok: true });
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["voided"]);
    expect(await order(o.id)).toMatchObject({ status: "diproses", mg_order_id: null, mg_order_code: null });
  });

  it("a booked shipment that VANISHED (no pending cancel) is flagged for the seller, and the next real status clears the flag", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: `c6-${runId}`, code: `C6-${runId}`, courier: "JT", booking: "accepted" } });
    const po = { number: o.number, awb: null, mgOrderId: `c6-${runId}`, mgOrderCode: `C6-${runId}`, mgIsPaid: true };
    const gone = await trk.pullMengantar(po, pullOpts(fakeProvider().fetch))!;
    if (!gone.ok) throw new Error(gone.error);
    expect(gone.data).toBeNull();
    expect(await trk.applyMengantarPull(po, gone.data, false)).toContain("problem:set");
    const flagged = await order(o.id);
    expect(flagged.status).toBe("diproses");
    expect(flagged.problem_at).not.toBeNull();
    // A second identical pull does not re-stamp it.
    expect(await trk.applyMengantarPull(po, null, false)).not.toContain("problem:set");
    // It was only a hiccup: the next pull finds it at origin → the flag clears.
    const p = fakeProvider({ track: () => ({ body: { success: true, data: [{ ORDER_ID: `C6-${runId}`, cnote_no: null, status: JSON.stringify({ "PENDING PICKUP": true }) }] } }) });
    const back = await trk.pullMengantar(po, pullOpts(p.fetch))!;
    if (!back.ok) throw new Error(back.error);
    await trk.applyMengantarPull(po, back.data, false);
    expect((await order(o.id)).problem_at).toBeNull();
  });

  it("tracking CANCELED on a pending cancel voids the booking and drops the provider ids (re-bookable)", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: `c3-${runId}`, code: `C3-${runId}`, courier: "JNE", awb: `JNEC3${runId}`, booking: "cancellation_requested" } });
    const p = fakeProvider({ track: () => ({ body: { success: true, data: [{ cnote_no: `JNEC3${runId}`, status: JSON.stringify({ CANCELED: true }) }] } }) });
    const po = { number: o.number, awb: `JNEC3${runId}`, mgOrderId: `c3-${runId}`, mgOrderCode: `C3-${runId}`, mgIsPaid: true };
    const r = await trk.pullMengantar(po, pullOpts(p.fetch))!;
    if (!r.ok) throw new Error(r.error);
    const ch = await trk.applyMengantarPull(po, r.data, true);
    expect(ch).toContain("cancel:voided");
    expect(await order(o.id)).toMatchObject({ status: "diproses", awb: null, mg_order_id: null, mg_order_code: null, mg_courier: null });
    expect((await bookings(o.id)).map((x) => x.status)).toEqual(["voided"]);
  });
});

suite("tracking — status comes from the provider's STATUS, never from a waybill existing", () => {
  const trackAnswer = (status: Record<string, boolean>, cnote: string | null) => () => ({ body: { success: true, data: [{ cnote_no: cnote, ORDER_ID: "x", status: JSON.stringify(status), history: [] }] } });
  const pollable = (o: { number: string }, over: Partial<{ awb: string | null; mgOrderCode: string | null; mgIsPaid: boolean | null }> = {}) => ({
    number: o.number,
    awb: null,
    mgOrderId: `t-${o.number}`,
    mgOrderCode: `T-${o.number}`,
    mgIsPaid: true,
    ...over,
  });
  async function pullAndApply(o: { number: string }, status: Record<string, boolean>, cnote: string | null, over = {}) {
    const p = fakeProvider({ track: trackAnswer(status, cnote) });
    const po = pollable(o, over);
    const r = await trk.pullMengantar(po, pullOpts(p.fetch))!;
    if (!r.ok) throw new Error(r.error);
    return { changed: await trk.applyMengantarPull(po, r.data, false), calls: p.calls };
  }

  it("PENDING PICKUP + a fresh cnote: the waybill fills, the order stays `diproses`", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: `t-x`, code: `T-x`, courier: "JNE" } });
    const { changed, calls } = await pullAndApply(o, { PENDING_PICKUP: true }, `JNEP${runId}`);
    expect(changed).toContain(`awb:JNEP${runId}`);
    expect(changed.some((c) => c.startsWith("status"))).toBe(false);
    expect(await order(o.id)).toMatchObject({ status: "diproses", awb: `JNEP${runId}` });
    // No waybill yet → it was pulled by ORDER_ID.
    expect(calls[0].path).toMatch(/^\/order\?order_id=/);
  });

  it("PICKED UP moves `diproses → dikirim` through the state machine", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: "t-y", code: "T-y", courier: "JNE", awb: `JNEK${runId}` } });
    const { changed, calls } = await pullAndApply(o, { PICKED_UP: true }, `JNEK${runId}`, { awb: `JNEK${runId}` });
    expect(changed).toContain("status:diproses→dikirim");
    expect((await order(o.id)).status).toBe("dikirim");
    expect(calls[0].path).toMatch(/^\/order\?tracking_id=/);
  });

  it("UNDELIVERED raises the problem flag and moves no status; an unknown flag changes nothing", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "dikirim", mg: { id: "t-z", code: "T-z", courier: "JNE", awb: `JNEU${runId}` } });
    const a = await pullAndApply(o, { UNDELIVERED: true }, `JNEU${runId}`, { awb: `JNEU${runId}` });
    expect(a.changed).toContain("problem:set");
    expect(await order(o.id)).toMatchObject({ status: "dikirim" });
    expect((await order(o.id)).problem_at).not.toBeNull();
    const b = await pullAndApply(o, { SOMETHING_NEW: true }, `JNEU${runId}`, { awb: `JNEU${runId}` });
    expect(b.changed).toEqual([]);
  });

  it("a waybill appearing on an UNPAID booking marks it paid", async () => {
    const store = await newStore();
    const o = await newOrder(store, { status: "diproses", mg: { id: "t-p", code: "T-p", courier: "JNE" } });
    await client`update orders set mg_is_paid = false where id = ${o.id}`;
    const { changed } = await pullAndApply(o, { PENDING_PICKUP: true }, `JNEPAID${runId}`, { mgIsPaid: false });
    expect(changed).toContain("paid");
    expect((await order(o.id)).mg_is_paid).toBe(true);
  });

  it("the sweep never pulls a KiriminAja order", async () => {
    const store = await newStore();
    const ka = await newOrder(store, { status: "diproses", provider: null, mg: { id: `ka-${runId}`, code: `KA-${runId}`, courier: "JNE" } });
    const p = fakeProvider();
    await trk.sweepMengantarTracking(opts(p.fetch));
    expect(p.calls.some((c) => c.path.includes(`KA-${runId}`))).toBe(false);
    expect((await order(ka.id)).status).toBe("diproses");
  });
});

// ── Mengantar Partner Business API: per-store accounts, money, rotation ──────────────────────────────

const ledger = async (storeId: string) => client<{ component: string | null; amount_idr: string }[]>`select component, amount_idr from ledger_entries where store_id = ${storeId}`;

suite("partner model — every call carries the ORDER's own store key", () => {
  it("booking uses THIS store's sealed key, stamps mg_env + mg_seller_id, and debits NOTHING in the TokoΦ ledger (O3)", async () => {
    const s1 = await newStore();
    const s2 = await newStore();
    const o = await newOrder(s1);
    // The buyer paid Rp10.000 shipping; the courier costs Rp18.000 — under the KiriminAja model that
    // Rp8.000 gap is a seller debit. Here the seller's own wallet pays Mengantar, so there is NONE.
    await client`update orders set shipping_idr = 10000 where id = ${o.id}`;
    const p = fakeProvider();
    const r = await book(s1, o.number, p.fetch);
    expect(r.ok).toBe(true);
    expect(p.calls.length).toBeGreaterThan(0);
    for (const c of p.calls) expect(c.key).toBe(keyOf.get(s1));
    expect(p.calls.some((c) => c.key === keyOf.get(s2))).toBe(false);
    const [row] = await client<{ mg_env: string; mg_seller_id: string }[]>`select mg_env, mg_seller_id from orders where id = ${o.id}`;
    expect(row).toEqual({ mg_env: "sandbox", mg_seller_id: sellerOf.get(s1) });
    // The seller's own wallet paid the courier: no shipping-*-debit, whatever the price gap.
    expect(await ledger(s1)).toEqual([]);
    const [b] = await client<{ seller_debit_idr: string; platform_margin_idr: string }[]>`select seller_debit_idr, platform_margin_idr from shipment_bookings where order_id = ${o.id}`;
    expect(Number(b.seller_debit_idr)).toBe(0);
    expect(Number(b.platform_margin_idr)).toBe(0);
    // The replay key is derived from OUR booking id (sent, never relied on).
    expect(p.posts()).toHaveLength(1);
  });

  it("a store with NO connected account is refused before any call (its checkouts fall back to the default provider)", async () => {
    const s = await newStore({ connected: false });
    const o = await newOrder(s);
    const p = fakeProvider();
    const r = await book(s, o.number, p.fetch);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/belum terhubung/);
    expect(p.calls).toHaveLength(0);
  });

  it("cancel / tracking of an order booked by ANOTHER seller account than the store holds now is refused, never pulled with the new key", async () => {
    const s = await newStore();
    const o = await newOrder(s, { status: "diproses", mg: { id: `sm-${runId}`, code: `SM-${runId}`, courier: "JNE", booking: "accepted" } });
    await client`update orders set mg_seller_id = 'some-old-seller' where id = ${o.id}`;
    const p = fakeProvider();
    const c = await mod.cancelMengantar(s, o.number, opts(p.fetch));
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/akun Mengantar toko yang lama/);
    const t = await trk.trackMengantar(s, o.number, { fetch: p.fetch });
    expect(t.ok).toBe(false);
    expect(p.calls).toHaveLength(0);
    const sweep = await trk.sweepMengantarTracking({ fetch: p.fetch });
    expect(sweep.accountMissing).toBeGreaterThanOrEqual(1);
    expect(p.calls.some((x) => x.path.includes(`SM-${runId}`))).toBe(false);
  });

  it("an order booked in ANOTHER environment is refused (env_mismatch)", async () => {
    const s = await newStore();
    const o = await newOrder(s, { status: "diproses", mg: { id: `em-${runId}`, code: `EM-${runId}`, courier: "JNE", booking: "accepted" } });
    await client`update orders set mg_env = 'production' where id = ${o.id}`;
    const p = fakeProvider();
    expect((await mod.cancelMengantar(s, o.number, opts(p.fetch))).error).toMatch(/lingkungan Mengantar lain/);
    expect(p.calls).toHaveLength(0);
  });

  it("after a key rotation the OLD key is never used again: cancel carries the new one", async () => {
    const s = await newStore();
    const o = await newOrder(s, { status: "diproses", mg: { id: `rk-${runId}`, code: `RK-${runId}`, courier: "JNE", booking: "accepted" } });
    const oldKey = keyOf.get(s)!;
    const partner = vi.fn(async (url: string) => {
      expect(String(url)).toMatch(/\/sellers\/api-key\/regenerate$/);
      return new Response(JSON.stringify({ success: true, data: { sellerId: sellerOf.get(s), apiKey: `rotated-${runId}`, callbackSecret: null } }), { status: 200 });
    });
    const pcfg = { env: "sandbox" as const, envSource: "default" as const, partnerBase: "https://partner.test", publicBase: "https://public.test", partnerId: "p-test", partnerSecret: "secret-test-0001", source: "env" as const };
    const r = await acct.rotateStoreMengantarKey(s, { partner: { cfg: pcfg, fetch: partner as unknown as typeof fetch } });
    expect(r.state).toBe("connected");
    expect(partner).toHaveBeenCalledTimes(1);
    const [row] = await client<{ key_version: number; key_hint: string }[]>`select key_version, key_hint from store_mengantar_accounts where store_id = ${s}`;
    expect(row.key_version).toBe(2);
    expect(row.key_hint).toBe(`rotated-${runId}`.slice(-4));
    const p = fakeProvider();
    expect((await mod.cancelMengantar(s, o.number, opts(p.fetch))).ok).toBe(true);
    expect(p.calls.length).toBeGreaterThan(0);
    for (const c of p.calls) {
      expect(c.key).toBe(`rotated-${runId}`);
      expect(c.key).not.toBe(oldKey);
    }
  });
});

suite("Bayar ongkir — the seller pays from THEIR OWN Mengantar wallet", () => {
  async function unpaidOrder() {
    const s = await newStore();
    const o = await newOrder(s, { status: "diproses", mg: { id: `pu-${runId}-${seq}`, code: `PU-${runId}-${seq}`, courier: "JT" } });
    await client`update orders set mg_is_paid = false, mg_batch_id = ${`batch-pu-${o.number}`} where id = ${o.id}`;
    return { s, o };
  }

  it("pays the batch once with the store's key; a second click sends nothing", async () => {
    const { s, o } = await unpaidOrder();
    const p = fakeProvider();
    const r = await mod.payMengantarUnpaid(s, o.number, opts(p.fetch));
    expect(r.ok).toBe(true);
    const pays = p.calls.filter((c) => c.path === "/order/pay-unpaid");
    expect(pays).toHaveLength(1);
    expect(pays[0].key).toBe(keyOf.get(s));
    expect(pays[0].body).toEqual({ batch_id: `batch-pu-${o.number}`, courier: "JT" });
    expect((await order(o.id)).mg_is_paid).toBe(true);
    const again = await mod.payMengantarUnpaid(s, o.number, opts(p.fetch));
    expect(again.ok).toBe(false);
    expect(p.calls.filter((c) => c.path === "/order/pay-unpaid")).toHaveLength(1);
  });

  it("a refusal makes it payable again; an outcome-unknown leaves it in flight (null), never re-payable", async () => {
    const a = await unpaidOrder();
    const refused = fakeProvider({ pay: () => ({ status: 400, body: { success: false, message: "Saldo tidak cukup" } }) });
    expect((await mod.payMengantarUnpaid(a.s, a.o.number, opts(refused.fetch))).ok).toBe(false);
    expect((await order(a.o.id)).mg_is_paid).toBe(false);

    const b = await unpaidOrder();
    const lost = fakeProvider({ pay: () => Promise.reject(new TypeError("socket hang up")) });
    const r = await mod.payMengantarUnpaid(b.s, b.o.number, opts(lost.fetch));
    expect(r).toMatchObject({ ok: false, pending: true });
    expect((await order(b.o.id)).mg_is_paid).toBeNull();
    const healthy = fakeProvider();
    expect((await mod.payMengantarUnpaid(b.s, b.o.number, opts(healthy.fetch))).ok).toBe(false);
    expect(healthy.calls).toHaveLength(0);
  });

  it("a SHORT pay (fewer paid than claimed) marks NONE paid — all stay in flight for tracking to settle", async () => {
    const { s, o } = await unpaidOrder();
    const o2 = await newOrder(s, { status: "diproses", mg: { id: `pu2-${runId}-${seq}`, code: `PU2-${runId}-${seq}`, courier: "JT" } });
    await client`update orders set mg_is_paid = false, mg_batch_id = ${`batch-pu-${o.number}`} where id = ${o2.id}`;
    const p = fakeProvider({ pay: () => ({ body: { success: true, data: 1, cnote_no: [] } }) });
    const r = await mod.payMengantarUnpaid(s, o.number, opts(p.fetch));
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(r.message).toMatch(/1 dari 2/);
    expect((await order(o.id)).mg_is_paid).toBeNull();
    expect((await order(o2.id)).mg_is_paid).toBeNull();
  });
}
);
