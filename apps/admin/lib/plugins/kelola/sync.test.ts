import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
const kelolaUrl = (n: number) => `https://kelolatim.com/api/public/toko/order/${TOKEN(n)}`;

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
    expect(k.calls[0].url).toBe(`https://kelolatim.com/api/public/toko/lead/${TOKEN(on.n)}`);
    expect(k.calls[0].body).toMatchObject({ customerName: "Budi Santoso", produk: "Batik Kawung", nilai: 99000 });
    expect(await sync.drainKelolaLeads(await store(on.storeId), on.storeId, k.fetch)).toBe(0);
  });

  it("the cron: a broken store is skipped untouched, and one failing store does not stop the next", async () => {
    const { runPluginCron } = await import("../registry");
    const broken = await newStore();
    await newOrder(broken.storeId);
    await client`update store_plugins set broken_at = now() where store_id = ${broken.storeId}`;
    // Two stores with work and no injected fetch: under NODE_ENV=test each push REFUSES (no network
    // write from a test) and throws. If the first failure stopped the loop, the second would be absent.
    const f1 = await newStore();
    await newOrder(f1.storeId);
    const f2 = await newStore();
    await newOrder(f2.storeId);
    const r = await runPluginCron(new Date());
    expect(r.failures).toEqual(expect.arrayContaining([`kelola:${f1.storeId}`, `kelola:${f2.storeId}`]));
    expect(r.failures).not.toContain(`kelola:${broken.storeId}`);
    const [touched] = await client<{ n: number }[]>`select count(*)::int as n from plugin_kelola_orders where store_id = ${broken.storeId}`;
    expect(touched.n).toBe(0);
  });

  it("saving the connection: a refused test stores nothing; success seals it; a re-save keeps connected_at", async () => {
    const { db } = await import("@tokophi/db");
    const [st] = await client<{ id: string }[]>`
      insert into stores (account_id, name, slug, status) values (${accountId}, 'Save', ${`kel-${runId}-save`}, 'active') returning id`;
    storeIds.push(st.id);
    await client`insert into store_plugins (store_id, plugin, enabled, activated_at) values (${st.id}, 'kelola', true, now())`;
    const url = `https://kelolatim.com/api/public/toko/order/twh_${runId}_save`;
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

// ── Aktif / Nonaktif (owner 2026-11-13: "plugins (aktif, non aktif)") ──────────────────────────────
// Semantics live in lib/plugins/registry.ts. Truth table under test:
//   Nonaktif      → the order hook and the cron never call the plugin; credential + history kept.
//   Aktif lagi    → pushes resume; what arrived while OFF is skipped (never back-filled); work
//                   pending from BEFORE the switch-off resumes; "Kirim ulang" can still send one.
//   Hapus koneksi → credential + this store's plugin rows deleted; re-activation starts unconnected.
suite("Kelola plugin — Aktif / Nonaktif / Hapus koneksi", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Nonaktif: neither the order hook nor the cron reaches the plugin; an active store in the same pass does", async () => {
    const { db } = await import("@tokophi/db");
    const registry = await import("../registry");
    const { kelolaPlugin } = await import("./index");
    // Both hooks are optional on the Plugin type; Kelola implements both.
    const hooks = kelolaPlugin as Required<typeof kelolaPlugin>;
    const onOrder = vi.spyOn(hooks, "onOrderCreated").mockResolvedValue("mocked");
    const onCron = vi.spyOn(hooks, "onCron").mockResolvedValue(0);

    const off = await newStore();
    const on = await newStore();
    const offOrder = await newOrder(off.storeId);
    const onOrderId = await newOrder(on.storeId);
    expect(await registry.deactivatePlugin(db, off.storeId, "kelola")).toBe(true);

    await registry.runOrderCreated(off.storeId, offOrder);
    await registry.runOrderCreated(on.storeId, onOrderId);
    expect(onOrder.mock.calls.map(([ctx]) => ctx.storeId)).toEqual([on.storeId]);

    await registry.runPluginCron(new Date());
    const cronStores = onCron.mock.calls.map(([ctx]) => ctx.storeId);
    expect(cronStores).toContain(on.storeId);
    expect(cronStores).not.toContain(off.storeId);

    // The plugin's own read refuses it too (defence in depth), and the credential is still there.
    expect(await sync.loadKelolaStore(db, off.storeId)).toBeNull();
    const [row] = await client<{ enabled: boolean; secret_enc: string | null; disabled_at: Date | null }[]>`
      select enabled, secret_enc, disabled_at from store_plugins where store_id = ${off.storeId}`;
    expect(row.enabled).toBe(false);
    expect(row.secret_enc).not.toBeNull();
    expect(row.disabled_at).not.toBeNull();
    expect(await kRow(off.storeId, offOrder)).toBeUndefined();
  });

  it("Aktif lagi: no re-typing; orders/leads from while OFF are skipped, never back-filled; earlier pending work resumes", async () => {
    const { db } = await import("@tokophi/db");
    const registry = await import("../registry");
    const { storeId, n } = await newStore({ pushLeads: true });
    const firstConfig = (await store(storeId)).config;

    // Before the switch-off: a prepaid order still unpaid, and a COD order whose push failed (503).
    const prepaidBefore = await newOrder(storeId, { method: "qris", placedAt: new Date(Date.now() - 2 * 3600_000) });
    const retryBefore = await newOrder(storeId, { placedAt: new Date(Date.now() - 2 * 3600_000) });
    expect(await sync.pushKelolaOrder(await store(storeId), storeId, retryBefore, { fetch: fakeKelola(503).fetch })).toBe("retry");

    await registry.deactivatePlugin(db, storeId, "kelola");
    const [{ disabled_at: offAt }] = await client<{ disabled_at: Date }[]>`select disabled_at from store_plugins where store_id = ${storeId}`;
    await registry.deactivatePlugin(db, storeId, "kelola"); // a second "off" keeps the first instant
    const [{ disabled_at: offAt2 }] = await client<{ disabled_at: Date }[]>`select disabled_at from store_plugins where store_id = ${storeId}`;
    expect(offAt2.getTime()).toBe(offAt.getTime());

    // While OFF: a new COD order, an abandoned checkout, and the earlier prepaid order gets paid.
    const duringOff = await newOrder(storeId);
    await client`
      insert into checkout_sessions (store_id, session_id, name, phone, status, abandoned_at, subtotal_idr, items)
      values (${storeId}, ${randomUUID()}, 'Rina Wati', '6282222222222', 'ditinggal', now(), 50000,
              ${client.json([{ name: "Kain", qty: 1, price: 50000 }])})`;
    await client`update payments set status = 'berhasil', paid_at = now() where order_id = ${prepaidBefore}`;

    await registry.activatePlugin(db, storeId, "kelola");
    const resumed = await store(storeId);
    expect(resumed.config).toEqual(firstConfig); // credential kept — nothing re-typed
    const skipped = await kRow(storeId, duringOff);
    expect(skipped.gave_up_at).not.toBeNull();
    expect(skipped.attempts).toBe(0);
    expect(skipped.last_error).toBe(sync.SKIPPED_WHILE_OFF);
    expect((await sync.kelolaSyncSummary(db, storeId)).skipped_off).toBe(1);

    // The cron resumes earlier work only: the prepaid order paid while OFF (placed while ON) + the 503 retry.
    await client`update plugin_kelola_orders set claimed_at = now() - interval '6 minutes' where order_id = ${retryBefore}`;
    const k = fakeKelola(201);
    expect(await sync.drainKelolaOrders(resumed, storeId, k.fetch)).toBe(2);
    const expected = await client<{ number: string }[]>`select number from orders where id in (${prepaidBefore}, ${retryBefore})`;
    expect(k.calls.map((c) => c.body.code).sort()).toEqual(expected.map((r) => r.number).sort());
    expect(await sync.drainKelolaLeads(resumed, storeId, k.fetch)).toBe(0); // the lead from while OFF is skipped too
    expect(k.calls).toHaveLength(2);

    // A new order after re-activation goes out; the skipped one only when a person asks for it.
    const after = await newOrder(storeId);
    expect(await sync.pushKelolaOrder(resumed, storeId, after, { fetch: k.fetch })).toBe("synced");
    expect(await sync.pushKelolaOrder(resumed, storeId, duringOff, { fetch: k.fetch })).toBe("skipped");
    expect(await sync.pushKelolaOrder(resumed, storeId, duringOff, { fetch: k.fetch, force: true })).toBe("synced");
    expect(k.calls).toHaveLength(4);
    expect(k.calls.every((c) => c.url === kelolaUrl(n))).toBe(true);
    const summary = await sync.kelolaSyncSummary(db, storeId);
    expect(summary.skipped_off).toBe(0);
    expect(summary.gave_up).toBe(0);
  });

  it("Hapus koneksi: credential and this store's rows are deleted; another store is untouched", async () => {
    const { db } = await import("@tokophi/db");
    const registry = await import("../registry");
    const gone = await newStore();
    const kept = await newStore();
    const goneOrder = await newOrder(gone.storeId);
    const keptOrder = await newOrder(kept.storeId);
    const k = fakeKelola(201);
    await sync.pushKelolaOrder(await store(gone.storeId), gone.storeId, goneOrder, { fetch: k.fetch });
    await sync.pushKelolaOrder(await store(kept.storeId), kept.storeId, keptOrder, { fetch: k.fetch });

    expect(await registry.uninstallPlugin(db, gone.storeId, "kelola")).toBe(true);
    const [left] = await client<{ plugins: number; orders: number }[]>`
      select (select count(*) from store_plugins where store_id = ${gone.storeId})::int as plugins,
             (select count(*) from plugin_kelola_orders where store_id = ${gone.storeId})::int as orders`;
    expect(left).toEqual({ plugins: 0, orders: 0 });
    expect((await kRow(kept.storeId, keptOrder)).synced_at).not.toBeNull();

    // Re-activating starts from nothing: on, but unconnected → still sends nothing.
    await registry.activatePlugin(db, gone.storeId, "kelola");
    expect(await sync.loadKelolaStore(db, gone.storeId)).toBeNull();
    const [listed] = (await registry.listPlugins(db, gone.storeId)).filter((p) => p.id === "kelola");
    expect(listed).toMatchObject({ installed: true, enabled: true });
  });
});
