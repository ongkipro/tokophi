import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SHIP-MENGANTAR phase 3 — the shipment actions DISPATCH BY THE ORDER'S STAMP.
//
// `orders.shipping_provider = 'mengantar'` → the Mengantar module; NULL (legacy) → KiriminAja,
// whatever the platform switch says. Driven through the real `"use server"` actions over a real
// Postgres row (the stamp is read through RLS); both providers' network functions are spies, so the
// claim is exactly "which provider's code was reached" — and nothing leaves the process.
const h = vi.hoisted(() => ({
  storeId: "",
  bookMengantar: vi.fn(),
  cancelMengantar: vi.fn(),
  mengantarOrderRates: vi.fn(),
  trackMengantar: vi.fn(),
  kaShippingPrice: vi.fn(),
  kaCreateOrder: vi.fn(),
  kaCancelShipment: vi.fn(),
  kaTrack: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  requireCapability: async (cap: string) => {
    if (cap !== "orders:write") throw new Error(`unexpected capability ${cap}`);
    return { storeId: h.storeId, userId: "u", role: "owner", email: "x@test.invalid", name: "x" };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// `withCurrentTenant` reads the session cookie; outside a request there is none.
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ storeId: h.storeId }) }));
vi.mock("@/lib/mengantar-shipping", async (orig) => ({
  ...(await orig<typeof import("@/lib/mengantar-shipping")>()),
  bookMengantar: h.bookMengantar,
  cancelMengantar: h.cancelMengantar,
  mengantarOrderRates: h.mengantarOrderRates,
}));
vi.mock("@/lib/mengantar-tracking", async (orig) => ({ ...(await orig<typeof import("@/lib/mengantar-tracking")>()), trackMengantar: h.trackMengantar }));
vi.mock("@tokophi/lib/kiriminaja", async (orig) => ({
  ...(await orig<typeof import("@tokophi/lib/kiriminaja")>()),
  kiriminajaConfigured: () => true,
  kaShippingPrice: h.kaShippingPrice,
  kaCreateOrder: h.kaCreateOrder,
  kaCancelShipment: h.kaCancelShipment,
  kaTrack: h.kaTrack,
}));

const URL_ = process.env.TEST_DATABASE_URL;
const suite = URL_ ? describe : describe.skip;
const runId = randomUUID().slice(0, 8);
let client: Sql;
let accountId = "";
let actions: typeof import("./shipping");
let bulk: typeof import("./bulk-shipping");
const MG = `DSP-${runId}-mg`;
const KA = `DSP-${runId}-ka`;

beforeAll(async () => {
  if (!URL_) return;
  process.env.DATABASE_URL = URL_;
  client = postgres(URL_, { max: 2, onnotice: () => {} });
  const [acc] = await client<{ id: string }[]>`insert into accounts (name) values (${`DSP ${runId}`}) returning id`;
  accountId = acc.id;
  const [st] = await client<{ id: string }[]>`insert into stores (account_id, name, slug, status, approved_at) values (${accountId}, ${`DSP ${runId}`}, ${`dsp-${runId}`}, 'active', now()) returning id`;
  h.storeId = st.id;
  await client`insert into store_settings (store_id, sender_kecamatan_id, sender_kecamatan_name) values (${st.id}, 2099, 'Uji')`;
  for (const [n, provider] of [
    [MG, "mengantar"],
    [KA, null],
  ] as const) {
    const [o] = await client<{ id: string }[]>`
      insert into orders (store_id, number, status, shipping_provider, ka_order_id, courier, service_type, ship_district_id, ship_address, subtotal_idr, total_idr, financial_status)
      values (${st.id}, ${n}, 'diproses'::order_status, ${provider}, ${provider ? null : `5758-${runId}`}, 'jne', 'JNE', 2099, 'Jl. Uji', 100000, 118000, 'dibayar')
      returning id`;
    await client`insert into payments (order_id, store_id, method, amount_idr, status, paid_at) values (${o.id}, ${st.id}, 'transfer'::payment_method, 118000, 'berhasil'::payment_status, now())`;
  }
  actions = await import("./shipping");
  bulk = await import("./bulk-shipping");
});

// Cleanup never fails the file: the shared `_test` DB has suites that sweep every store (see
// mengantar-shipping.test.ts). A leftover row is logged, never thrown.
const tidy = async (q: () => Promise<unknown>) => {
  try {
    await q();
  } catch (e) {
    console.warn("[shipping-dispatch.test] cleanup left a row:", e instanceof Error ? e.message : e);
  }
};

afterAll(async () => {
  if (!client) return;
  try {
    await tidy(() => client`delete from payments where store_id = ${h.storeId}`);
    await tidy(() => client`delete from orders where store_id = ${h.storeId}`);
    await tidy(() => client`delete from store_settings where store_id = ${h.storeId}`);
    // The billing cron suite runs over EVERY store in the shared _test DB and may invoice ours meanwhile.
    await tidy(() => client`delete from invoices where store_id = ${h.storeId}`);
    await tidy(() => client`delete from platform_activity where store_id = ${h.storeId}`);
    await tidy(() => client`delete from stores where id = ${h.storeId}`);
    await tidy(() => client`delete from accounts where id = ${accountId}`);
  } finally {
    await client.end();
  }
});

beforeEach(() => {
  for (const f of [h.bookMengantar, h.cancelMengantar, h.mengantarOrderRates, h.trackMengantar, h.kaShippingPrice, h.kaCreateOrder, h.kaCancelShipment, h.kaTrack]) f.mockReset();
  h.bookMengantar.mockResolvedValue({ ok: true, awb: null, kaOrderId: "MGO-1", awbPending: true });
  h.cancelMengantar.mockResolvedValue({ ok: true, pending: true });
  h.trackMengantar.mockResolvedValue({ ok: true, message: "ok", history: [] });
  h.mengantarOrderRates.mockResolvedValue({
    ok: true,
    codEnabled: false,
    rates: [{ service: "JNE", code: "jne", type: "JNE", cost: 18000, etd: "", cod: false, group: "regular", codFee: { amount: null, pct: null, minimum: null }, insurance: 0, forceInsurance: false }],
  });
  h.kaShippingPrice.mockResolvedValue({ ok: false, results: [], error: "ka-was-called" });
  h.kaTrack.mockResolvedValue({ ok: false, error: "ka-was-called", httpStatus: 200 });
});

const mgSpies = () => [h.bookMengantar, h.cancelMengantar, h.mengantarOrderRates, h.trackMengantar].reduce((a, f) => a + f.mock.calls.length, 0);
const kaSpies = () => [h.kaShippingPrice, h.kaCreateOrder, h.kaCancelShipment, h.kaTrack].reduce((a, f) => a + f.mock.calls.length, 0);

suite("a Mengantar-stamped order never reaches KiriminAja", () => {
  it("createShipment → bookMengantar with the session's store", async () => {
    const r = await actions.createShipment({ orderNumber: MG, service: "jne", serviceType: "JNE", serviceName: "JNE", cost: 18000 });
    expect(r.ok).toBe(true);
    expect(h.bookMengantar).toHaveBeenCalledTimes(1);
    expect(h.bookMengantar.mock.calls[0][0]).toBe(h.storeId);
    expect(kaSpies()).toBe(0);
  });
  it("getShippingRates / cancelShipment / trackShipment", async () => {
    await actions.getShippingRates({ orderNumber: MG });
    await actions.cancelShipment(MG);
    await actions.trackShipment(MG);
    expect(h.mengantarOrderRates).toHaveBeenCalledTimes(1);
    expect(h.cancelMengantar).toHaveBeenCalledTimes(1);
    expect(h.trackMengantar).toHaveBeenCalledTimes(1);
    expect(kaSpies()).toBe(0);
  });
});

suite("a KiriminAja (NULL-stamped) order never reaches Mengantar", () => {
  it("getShippingRates / trackShipment / cancelShipment / createShipment take the KiriminAja path", async () => {
    expect((await actions.getShippingRates({ orderNumber: KA })).error).toBe("ka-was-called");
    await actions.trackShipment(KA);
    expect(h.kaTrack).toHaveBeenCalledTimes(1);
    // KiriminAja's own rule answers (no waybill → refused before its call): proof of the KA branch.
    expect((await actions.cancelShipment(KA)).error).toMatch(/Nomor resi belum terbit/);
    const c = await actions.createShipment({ orderNumber: KA, service: "jne", serviceType: "REG", serviceName: "JNE", cost: 1 });
    expect(c.ok).toBe(false);
    expect(mgSpies()).toBe(0);
  });
});

suite("bulkGenerateResi dispatches per order", () => {
  it("books the Mengantar order through bookMengantar (the shopper's service) and the KiriminAja one through KiriminAja", async () => {
    const r = await bulk.bulkGenerateResi([MG, KA]);
    expect(h.bookMengantar).toHaveBeenCalledTimes(1);
    expect(h.bookMengantar.mock.calls[0][1]).toMatchObject({ orderNumber: MG, service: "jne", serviceType: "JNE", cost: 18000 });
    expect(h.kaShippingPrice).toHaveBeenCalledTimes(1); // the KA order's re-quote, nothing for MG
    expect(r.done).toBe(1);
    expect(r.failed.map((f) => f.number)).toEqual([KA]);
  });
});
