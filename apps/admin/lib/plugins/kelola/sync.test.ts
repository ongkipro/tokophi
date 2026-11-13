import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Kelola plugin's Postgres side (KELOLA_PLUGIN_SPEC.md §4.4, §6). REAL Postgres; Kelola is a FAKE
// fetch that records every call — nothing leaves the machine.
const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);

let client: Sql;
let sync: typeof import("./sync");
let accountId = "";
const storeIds: string[] = [];

type Call = { url: string; body: Record<string, unknown> };
/** A Kelola stand-in: answers by status (a function = dynamic), records every call. */
function fakeKelola(answer: number | ((call: Call, n: number) => number | Promise<number>) = 201, body?: (c: Call) => unknown) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const call = { url, body: JSON.parse(String(init?.body ?? "{}")) };
    calls.push(call);
    const status = typeof answer === "function" ? await answer(call, calls.length) : answer;
    const out = body ? body(call) : status < 300 ? { ok: true, id: `k-${calls.length}`, code: call.body.code, status: "menunggu" } : { error: "x" };
    return new Response(JSON.stringify(out), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const TOKEN = (n: number) => `twh_${runId}_${n}`;
const kelolaUrl = (n: number) => `https://kelola.test/api/public/toko/order/${TOKEN(n)}`;

async function newStore(o: { connectedAt?: Date; pushLeads?: boolean; enabled?: boolean } = {}) {
  const n = storeIds.length;
  const [st] = await client<{ id: string }[]>`
    insert into stores (account_id, name, slug, status) values (${accountId}, ${`Toko KEL ${runId}`}, ${`kel-${runId}-${n}`}, 'active') returning id`;
  storeIds.push(st.id);
  const { encryptSecret } = await import("@/lib/crypto");
  const blob = encryptSecret(JSON.stringify({ webhook_url: kelolaUrl(n), webhook_secret: `sec-${runId}-${n}` }), sync.kelolaScope(st.id, 1));
  await client`
    insert into store_plugins (store_id, plugin, enabled, settings, secret_enc, secret_v, connected_at, activated_at)
    values (${st.id}, 'kelola', ${o.enabled ?? true}, ${client.json({ push_leads: o.pushLeads ?? false })}, ${blob}, 1,
            ${o.connectedAt ?? new Date(Date.now() - 24 * 3600_000)}, now())`;
  return { storeId: st.id, n };
}

let orderSeq = 0;
async function newOrder(storeId: string, o: { method?: string; payStatus?: string; status?: string; placedAt?: Date; shipping?: number; noPayment?: boolean } = {}) {
  orderSeq += 1;
  const [ord] = await client<{ id: string }[]>`
    insert into orders (store_id, number, status, placed_at, subtotal_idr, shipping_idr, total_idr, ship_recipient, ship_phone, ship_address, city, province)
    values (${storeId}, ${`KEL-${runId}-${orderSeq}`}, ${o.status ?? "baru"}, ${o.placedAt ?? new Date()}, 150000, ${o.shipping ?? 12000},
            ${150000 + (o.shipping ?? 12000)}, 'Siti Aminah', '6281234567890', 'Jl. Melati 12 RT 03/05', 'Sleman', 'DI Yogyakarta')
    returning id`;
  await client`insert into order_line_items (order_id, title, qty, price_idr, total_idr) values (${ord.id}, 'Batik Parang', 2, 75000, 150000)`;
  if (!o.noPayment) {
    const status = o.payStatus ?? (o.method && o.method !== "cod" ? "menunggu" : "berhasil");
    await client`
      insert into payments (order_id, store_id, method, amount_idr, status, paid_at)
      values (${ord.id}, ${storeId}, ${o.method ?? "cod"}, 162000, ${status}, ${status === "berhasil" ? new Date() : null})`;
  }
  return ord.id;
}

const kRow = async (storeId: string, orderId: string) =>
  (await client<{ synced_at: Date | null; gave_up_at: Date | null; attempts: number; last_error: string | null; claimed_at: Date | null }[]>`
    select synced_at, gave_up_at, attempts, last_error, claimed_at from plugin_kelola_orders where store_id = ${storeId} and order_id = ${orderId}`)[0];
const store = async (storeId: string) => {
  const s = await sync.loadKelolaStore((await import("@tokophi/db")).db, storeId);
  if (!s) throw new Error("store not connected");
  return s;
};

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  process.env.INTEGRATION_TOKEN_KEY ??= "test-integration-key-not-a-secret-0001";
  client = postgres(URL_, { max: 4, onnotice: () => {} });
  sync = await import("./sync");
  const [a] = await client<{ id: string }[]>`insert into accounts (name) values (${`KEL ${runId}`}) returning id`;
  accountId = a.id;
});

afterAll(async () => {
  if (!client) return;
  try {
    for (const s of storeIds) {
      await client`delete from plugin_kelola_orders where store_id = ${s}`;
      await client`delete from plugin_kelola_leads where store_id = ${s}`;
      await client`delete from store_plugins where store_id = ${s}`;
      await client`delete from checkout_sessions where store_id = ${s}`;
      await client`delete from payments where store_id = ${s}`;
      await client`delete from order_line_items where order_id in (select id from orders where store_id = ${s})`;
      await client`delete from orders where store_id = ${s}`;
      await client`delete from stores where id = ${s}`;
    }
    await client`delete from accounts where id = ${accountId}`;
  } finally {
    await client.end();
  }
});

suite("Kelola plugin — dormant, eligibility, claim, outcomes, isolation", () => {
  it("dormant: a store with no plugin row has no Kelola store, and a disabled one is off too", async () => {
    const { db } = await import("@tokophi/db");
    const [st] = await client<{ id: string }[]>`
      insert into stores (account_id, name, slug, status) values (${accountId}, 'Dormant', ${`kel-${runId}-dormant`}, 'active') returning id`;
    storeIds.push(st.id);
    expect(await sync.loadKelolaStore(db, st.id)).toBeNull();
    const off = await newStore({ enabled: false });
    expect(await sync.loadKelolaStore(db, off.storeId)).toBeNull();
  });

  it("a COD order is pushed once, signed, with the real ongkir; a second drain sends nothing", async () => {
    const { storeId, n } = await newStore();
    const orderId = await newOrder(storeId);
    const k = fakeKelola(201);
    expect(await sync.pushKelolaOrder(await store(storeId), storeId, orderId, { fetch: k.fetch })).toBe("synced");
    expect(k.calls).toHaveLength(1);
    expect(k.calls[0].url).toBe(kelolaUrl(n));
    expect(k.calls[0].body).toMatchObject({ payment: "cod", ongkir: 12000, codValue: 162000, customerName: "Siti Aminah" });
    expect((k.calls[0].body.items as unknown[]).length).toBe(1);
    expect((await kRow(storeId, orderId)).synced_at).not.toBeNull();
    expect(await sync.drainKelolaOrders(await store(storeId), storeId, k.fetch)).toBe(0);
    expect(k.calls).toHaveLength(1);
  });

  it("prepaid: never pushed while unpaid, pushed once its payment is berhasil", async () => {
    const { storeId } = await newStore();
    const orderId = await newOrder(storeId, { method: "qris" });
    const k = fakeKelola(201);
    expect(await sync.pushKelolaOrder(await store(storeId), storeId, orderId, { fetch: k.fetch })).toBe("skipped");
    expect(await sync.drainKelolaOrders(await store(storeId), storeId, k.fetch)).toBe(0);
    expect(k.calls).toHaveLength(0);
    expect(await kRow(storeId, orderId)).toBeUndefined();
    await client`update payments set status = 'berhasil', paid_at = now() where order_id = ${orderId}`;
    expect(await sync.drainKelolaOrders(await store(storeId), storeId, k.fetch)).toBe(1);
    expect(k.calls[0].body.payment).toBe("transfer");
    expect(k.calls[0].body.codValue).toBeNull();
  });

  it("batal/retur, no payment row, older than connected_at, or older than 7 days: never pushed", async () => {
    const { storeId } = await newStore({ connectedAt: new Date(Date.now() - 3 * 24 * 3600_000) });
    await newOrder(storeId, { status: "batal" });
    await newOrder(storeId, { status: "retur" });
    await newOrder(storeId, { noPayment: true });
    await newOrder(storeId, { placedAt: new Date(Date.now() - 4 * 24 * 3600_000) }); // before connect
    const k = fakeKelola(201);
    expect(await sync.drainKelolaOrders(await store(storeId), storeId, k.fetch)).toBe(0);
    expect(k.calls).toHaveLength(0);
    const old = await newStore({ connectedAt: new Date(Date.now() - 30 * 24 * 3600_000) });
    await newOrder(old.storeId, { placedAt: new Date(Date.now() - 8 * 24 * 3600_000) });
    expect(await sync.drainKelolaOrders(await store(old.storeId), old.storeId, k.fetch)).toBe(0);
    expect(k.calls).toHaveLength(0);
  });

  it("hook and cron racing on one order: exactly ONE POST", async () => {
    const { storeId } = await newStore();
    const orderId = await newOrder(storeId);
    // Kelola answers slowly, so the second sender arrives while the first POST is in flight.
    const k = fakeKelola(async () => { await new Promise((r) => setTimeout(r, 300)); return 201; });
    const s = await store(storeId);
    const results = await Promise.all([
      sync.pushKelolaOrder(s, storeId, orderId, { fetch: k.fetch }),
      sync.drainKelolaOrders(s, storeId, k.fetch),
      sync.pushKelolaOrder(s, storeId, orderId, { fetch: k.fetch }),
    ]);
    expect(k.calls).toHaveLength(1);
    expect(results.filter((r) => r === "synced").length + (results[1] as number)).toBe(1);
  });

  it("400: given up, never retried by the cron; Kirim ulang clears it and sends again", async () => {
    const { storeId } = await newStore();
    const orderId = await newOrder(storeId);
    const bad = fakeKelola(400, () => ({ error: "invalid", path: "items.0.sku" }));
    expect(await sync.pushKelolaOrder(await store(storeId), storeId, orderId, { fetch: bad.fetch })).toBe("gave_up");
    expect((await kRow(storeId, orderId)).gave_up_at).not.toBeNull();
    await client`update plugin_kelola_orders set claimed_at = now() - interval '3 hours' where order_id = ${orderId}`;
    expect(await sync.drainKelolaOrders(await store(storeId), storeId, bad.fetch)).toBe(0);
    expect(bad.calls).toHaveLength(1);
    const good = fakeKelola(201);
    expect(await sync.pushKelolaOrder(await store(storeId), storeId, orderId, { fetch: good.fetch, force: true })).toBe("synced");
    expect(good.calls).toHaveLength(1);
  });

  it("401: the store is marked broken, the tick stops for it, and it stays off until re-saved", async () => {
    const { storeId } = await newStore();
    await newOrder(storeId);
    await newOrder(storeId);
    const k = fakeKelola(401);
    expect(await sync.drainKelolaOrders(await store(storeId), storeId, k.fetch)).toBe(0);
    expect(k.calls).toHaveLength(1);
    const { db } = await import("@tokophi/db");
    expect(await sync.loadKelolaStore(db, storeId)).toBeNull();
  });

  it("503: retried only after the backoff, and the stored error never carries the token or secret", async () => {
    const { storeId, n } = await newStore();
    const orderId = await newOrder(storeId);
    const down = fakeKelola(503, (c) => ({ error: `upstream for ${c.url} with sec-${runId}-${n}` }));
    expect(await sync.pushKelolaOrder(await store(storeId), storeId, orderId, { fetch: down.fetch })).toBe("retry");
    const row = await kRow(storeId, orderId);
    expect(row.attempts).toBe(1);
    expect(row.last_error).not.toContain(TOKEN(n));
    expect(row.last_error).not.toContain(`sec-${runId}-${n}`);
    expect(await sync.drainKelolaOrders(await store(storeId), storeId, down.fetch)).toBe(0);
    expect(down.calls).toHaveLength(1); // inside the 5-minute backoff
    await client`update plugin_kelola_orders set claimed_at = now() - interval '6 minutes' where order_id = ${orderId}`;
    const up = fakeKelola(201);
    expect(await sync.drainKelolaOrders(await store(storeId), storeId, up.fetch)).toBe(1);
  });

  it("two stores: one store's drain never touches the other's orders, and goes to its own URL", async () => {
    const a = await newStore();
    const b = await newStore();
    const aOrder = await newOrder(a.storeId);
    const bOrder = await newOrder(b.storeId);
    const k = fakeKelola(201);
    expect(await sync.drainKelolaOrders(await store(a.storeId), a.storeId, k.fetch)).toBe(1);
    expect(k.calls.map((c) => c.url)).toEqual([kelolaUrl(a.n)]);
    expect(await kRow(b.storeId, bOrder)).toBeUndefined();
    // Store A's handle cannot claim store B's order either.
    expect(await sync.pushKelolaOrder(await store(a.storeId), a.storeId, bOrder, { fetch: k.fetch })).toBe("skipped");
    expect(k.calls).toHaveLength(1);
    expect((await kRow(a.storeId, aOrder)).synced_at).not.toBeNull();
    // No plugin row anywhere may pair a store with another store's order — the payload read is
    // scoped too, so a leak in the CLAIM would send nothing and stay invisible without this.
    const [cross] = await client<{ n: number }[]>`
      select count(*)::int as n from plugin_kelola_orders k join orders o on o.id = k.order_id
       where k.store_id <> o.store_id and k.store_id = any(${storeIds})`;
    expect(cross.n).toBe(0);
  });

  it("leads: opt-in; only stored `ditinggal` with a phone and not recovered; sent to the lead URL", async () => {
    const off = await newStore();
    const on = await newStore({ pushLeads: true });
    const ins = (storeId: string, o: { status: string; phone?: string | null; recovered?: boolean }) => client`
      insert into checkout_sessions (store_id, session_id, name, phone, status, abandoned_at, recovered_at, subtotal_idr, items)
      values (${storeId}, ${randomUUID()}, 'Budi Santoso', ${o.phone === undefined ? "6281111111111" : o.phone}, ${o.status},
              ${o.status === "aktif" ? null : new Date()}, ${o.recovered ? new Date() : null}, 99000,
              ${client.json([{ name: "Batik Kawung", qty: 1, price: 99000 }])})`;
    for (const st of [off.storeId, on.storeId]) {
      await ins(st, { status: "ditinggal" });
      await ins(st, { status: "aktif" });
      await ins(st, { status: "ditinggal", phone: null });
      await ins(st, { status: "ditinggal", recovered: true });
    }
    const k = fakeKelola(201);
    expect(await sync.drainKelolaLeads(await store(off.storeId), off.storeId, k.fetch)).toBe(0);
    expect(await sync.drainKelolaLeads(await store(on.storeId), on.storeId, k.fetch)).toBe(1);
    expect(k.calls).toHaveLength(1);
    expect(k.calls[0].url).toBe(`https://kelola.test/api/public/toko/lead/${TOKEN(on.n)}`);
    expect(k.calls[0].body).toMatchObject({ customerName: "Budi Santoso", produk: "Batik Kawung", nilai: 99000 });
    expect(await sync.drainKelolaLeads(await store(on.storeId), on.storeId, k.fetch)).toBe(0);
  });

  it("saving the connection: a refused test stores nothing; success seals it; a re-save keeps connected_at", async () => {
    const { db } = await import("@tokophi/db");
    const [st] = await client<{ id: string }[]>`
      insert into stores (account_id, name, slug, status) values (${accountId}, 'Save', ${`kel-${runId}-save`}, 'active') returning id`;
    storeIds.push(st.id);
    await client`insert into store_plugins (store_id, plugin, enabled, activated_at) values (${st.id}, 'kelola', true, now())`;
    const url = `https://kelola.test/api/public/toko/order/twh_${runId}_save`;
    const refused = await sync.saveKelolaConnection(db, st.id, { url, secret: "wrong" }, fakeKelola(401).fetch);
    expect(refused.ok).toBe(false);
    expect((await client`select secret_enc, connected_at from store_plugins where store_id = ${st.id}`)[0]).toEqual({ secret_enc: null, connected_at: null });

    expect((await sync.saveKelolaConnection(db, st.id, { url, secret: "right-secret" }, fakeKelola(400).fetch)).ok).toBe(true);
    const [first] = await client<{ secret_enc: string; connected_at: Date }[]>`select secret_enc, connected_at from store_plugins where store_id = ${st.id}`;
    expect(first.secret_enc).toMatch(/^v1:/);
    expect(first.secret_enc).not.toContain("right-secret");
    expect(first.secret_enc).not.toContain(`twh_${runId}_save`);

    // Re-save with the secret left empty: keeps the stored secret, and connected_at does not move.
    await client`update store_plugins set broken_at = now() where store_id = ${st.id}`;
    expect((await sync.saveKelolaConnection(db, st.id, { url, secret: "" }, fakeKelola(400).fetch)).ok).toBe(true);
    const [again] = await client<{ connected_at: Date; broken_at: Date | null }[]>`select connected_at, broken_at from store_plugins where store_id = ${st.id}`;
    expect(again.connected_at.getTime()).toBe(first.connected_at.getTime());
    expect(again.broken_at).toBeNull();
    const view = await sync.kelolaSettingsView(db, st.id);
    expect(JSON.stringify(view)).not.toContain("right-secret");
    expect(JSON.stringify(view)).not.toContain(`twh_${runId}_save`);
  });
});
