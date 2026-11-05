import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@tokophi/db/schema";
import { setProviderConfigLoader, type ProviderRows } from "@tokophi/lib/provider-config";
import type { MgRate } from "@tokophi/lib/mengantar";

// 🔴 Mengantar Partner Business API — THE ONE PRICE PRODUCER FOLLOWS THE SWITCH *AND* THE STORE.
//
// Switch = Mengantar quotes with THE STORE'S OWN seller key only when the store has a connected
// account and the order is not COD; otherwise it FALLS BACK to KiriminAja (owner O6).
//
// `quoteShipping` is what `/api/public/ongkir` shows the shopper and what `/api/public/order`
// RE-QUOTES and stores. These tests drive the real function with the platform switch flipped both
// ways: the database is a table-keyed fake (each `from(table)` answers that table's fixture rows),
// the provider config comes through the real loader seam, the Mengantar client is REAL and only
// `fetch` is stubbed — so the URL it would call is what is asserted, and no request leaves the box.
// KiriminAja's client is mocked: its own behaviour is pinned elsewhere; here only "the switch picks
// it, unchanged" is the claim.

const h = vi.hoisted(() => ({
  tables: new Map<unknown, unknown[]>(),
  kaShippingPrice: vi.fn(),
  weightForCart: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@tokophi/db/mengantar-account", () => ({ openStoreMengantar: h.open }));

vi.mock("@tokophi/db", async () => {
  const schemaMod = await import("@tokophi/db/schema");
  // A query builder that ignores its predicates: each test seeds exactly the rows the WHERE would
  // have returned for its one store / district.
  const chain = (rows: unknown[]): unknown => {
    const p = Promise.resolve(rows);
    return {
      where: () => chain(rows),
      limit: () => chain(rows),
      orderBy: () => chain(rows),
      then: p.then.bind(p),
    };
  };
  return { schema: schemaMod, db: { select: () => ({ from: (t: unknown) => chain(h.tables.get(t) ?? []) }) } };
});
vi.mock("@tokophi/lib/kiriminaja", () => ({
  kiriminajaConfigured: () => true,
  kaShippingPrice: h.kaShippingPrice,
  kaAddressByName: vi.fn(async () => []),
}));
vi.mock("@/lib/shipping-weight", () => ({ weightForCart: h.weightForCart }));
vi.mock("@/lib/cod", () => ({
  getCodPolicy: vi.fn(async () => ({ enabled: true, allows: () => true, reason: () => null })),
}));

const { quoteShipping, mengantarRates, mgEstimateCacheKey, findRate } = await import("./shipping-quote");

const STORE = "00000000-0000-4000-8000-000000000001";
const ORIGIN = "aaaaaaaaaaaaaaaaaaaaaaaa";
const DISTRICT_REP = "bbbbbbbbbbbbbbbbbbbbbbbb"; // used only in the pure cache-key assertions
const KEL_AREA = "cccccccccccccccccccccccc";
const FAKE_KEY = "test-mg-key-not-a-secret-0001";

// Per-variant fixture weights; the stub sums EVERY line like the real weightForCart does, so a quote
// that weighed only the first line would send a different kg.
const WEIGHTS: Record<string, number> = { a: 700, b: 400, c: 250 };
function weigh(_db: unknown, _store: string, cart: { variantId?: string; qty?: number }[]) {
  const grams = cart.reduce((s, l) => s + (WEIGHTS[l.variantId ?? ""] ?? 0) * (l.qty ?? 0), 0);
  return { grams, billableGrams: Math.max(grams, 1000), missing: [], resolved: cart.length };
}
const CART = [
  { variantId: "a", qty: 1 },
  { variantId: "b", qty: 2 },
  { variantId: "c", qty: 2 },
]; // 700 + 800 + 500 = 2000 g → 2 kg

/** The platform switch, and whether THIS store has a connected Mengantar account (its own key). */
function config(shipping: "kiriminaja" | "mengantar", connected = true) {
  const rows: ProviderRows = { kiriminaja: null, autolaris: null, mengantar: null, shipping: { activeProvider: shipping } };
  setProviderConfigLoader(async () => rows);
  h.open.mockReset().mockResolvedValue(
    connected
      ? { ok: true, cfg: { env: "sandbox", base: "https://sandbox.mengantar.com", key: FAKE_KEY }, sellerId: "s1", env: "sandbox", pickupAddressId: null }
      : { ok: false, reason: "not_connected" },
  );
}
const KA_SPX = { ok: true, results: [{ service: "spx", service_name: "SPX Standard", service_type: "1", cost: "13700", etd: "2-3", cod: true, group: "regular" }] };

// The estimate cache is process-wide and keyed on the AREA ids, so every seed() gets a fresh
// representative area: no test is ever answered from another test's cached estimate.
const current = { rep: "" as string | null };
function seed(over: { platform?: string[]; merchant?: string[] | null; picked?: { courier: string; service: string }[]; origin?: string | null; rep?: string | null; kel?: { name: string; mengantarAreaId: string | null }[] } = {}) {
  h.tables.clear();
  h.tables.set(schema.platformCouriers, (over.platform ?? ["jne", "spx", "jnt", "sap", "sicepat"]).map((courier) => ({ courier, enabled: true })));
  h.tables.set(schema.storeSettings, [
    { kecamatanId: 101, kecamatanName: "Gudang", mengantarAreaId: over.origin === undefined ? ORIGIN : over.origin, couriers: over.merchant ?? null },
  ]);
  h.tables.set(schema.storeShippingMethods, over.picked ?? []);
  current.rep = over.rep === undefined ? uniq() : over.rep;
  h.tables.set(schema.kiriminajaAreas, [{ areaId: current.rep }]);
  h.tables.set(schema.kelurahan, over.kel ?? []);
}

let n = 0;
function uniq(): string {
  return (++n).toString(16).padStart(24, "d");
}

// One Mengantar `/order/estimate?courier=all` answer, shaped like the live map (keys verbatim).
const ESTIMATE = {
  JNE: { price: 18000, estimatedSpecialPrice: 15300, unsupported_cod: false, estimate_delivery: "2-3 hari" },
  JT: { price: 17000, estimatedSpecialPrice: 14000, unsupported_cod: false },
  SAPLite: { price: 11000, estimatedSpecialPrice: 9000, unsupported_cod: true },
  spx: { price: 12000, estimatedSpecialPrice: 10000, unsupported_cod: false },
  JNECargo: { price: 50000, unsupported_cod: false },
  SiCepat: { price: 16000, unsupported: true },
};

let fetchMock: ReturnType<typeof vi.fn>;
function answer(body: unknown, status = 200) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  answer({ success: true, data: ESTIMATE });
  h.weightForCart.mockReset().mockImplementation(weigh);
  h.kaShippingPrice.mockReset();
  seed();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setProviderConfigLoader(null);
});


describe("quoteShipping — switch = kiriminaja (unchanged)", () => {
  it("asks KiriminAja, never the Mengantar API, and stamps the provider", async () => {
    config("kiriminaja");
    h.kaShippingPrice.mockResolvedValue({
      ok: true,
      results: [{ service: "spx", service_name: "SPX Standard", service_type: "1", cost: "13700", etd: "2-3", cod: true, group: "regular" }],
    });
    const q = await quoteShipping({ storeId: STORE, destinationId: 321, items: CART });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.kaShippingPrice).toHaveBeenCalledTimes(1);
    expect(h.kaShippingPrice.mock.calls[0][0]).toMatchObject({ origin: 101, destination: 321, weight: 2000 });
    expect(q).toMatchObject({ ok: true, provider: "kiriminaja", destinationAreaId: null, codEnabled: true });
    if (q.ok) expect(q.rates).toEqual([{ name: "SPX Standard", code: "spx", type: "1", cost: 13700, etd: "2-3", cod: true, group: "regular" }]);
  });
});

describe("quoteShipping — switch = mengantar", () => {
  it("prices from the SELLER's area to the district representative, by the summed weight in KG", async () => {
    config("mengantar");
    const q = await quoteShipping({ storeId: STORE, destinationId: 321, items: CART });
    expect(h.kaShippingPrice).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toMatch(/\/order\/estimate$/);
    expect(url.searchParams.get("origin_id")).toBe(ORIGIN);
    expect(url.searchParams.get("destination_id")).toBe(current.rep);
    expect(url.searchParams.get("courier")).toBe("all");
    // Σ every line: 700 + 2×400 + 2×250 = 2000 g → "2" kg (the first line alone would be the 1 kg floor).
    expect(url.searchParams.get("weight")).toBe("2");
    expect(url.searchParams.has("COD_AMOUNT")).toBe(false);
    expect(h.weightForCart.mock.calls[0][2]).toHaveLength(3);
    expect(q).toMatchObject({ ok: true, provider: "mengantar", codEnabled: false, billableGrams: 2000 });
    expect(q).toMatchObject({ destinationAreaId: current.rep });
    // With THIS store's own key, opened for THIS store.
    expect(url.pathname.startsWith(`/api/public/${FAKE_KEY}/`)).toBe(true);
    expect(h.open).toHaveBeenCalledWith(STORE);
  });

  it("sends a fractional kg as-is and keeps the 1 kg floor", async () => {
    config("mengantar");
    await quoteShipping({ storeId: STORE, destinationId: 322, items: [{ variantId: "a", qty: 1 }, { variantId: "b", qty: 2 }] });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("weight")).toBe("1.5");
    fetchMock.mockClear();
    await quoteShipping({ storeId: STORE, destinationId: 323, items: [{ variantId: "c", qty: 1 }] });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("weight")).toBe("1");
  });

  it("maps MgRate → QuotedRate: normalised courier, estimate key as type, PRICE (never the special price), cod forced false", async () => {
    config("mengantar");
    const q = await quoteShipping({ storeId: STORE, destinationId: 324, items: CART });
    if (!q.ok) throw new Error(q.error);
    expect(q.rates).toEqual([
      { name: "JNE", code: "jne", type: "JNE", cost: 18000, etd: "2-3 hari", cod: false, group: "regular" },
      { name: "J&T Express", code: "jnt", type: "JT", cost: 17000, etd: "", cod: false, group: "regular" },
      { name: "Shopee Express (SPX)", code: "spx", type: "spx", cost: 12000, etd: "", cod: false, group: "regular" },
    ]);
    // Cargo and `unsupported` keys never surface; the order API can find what the checkout showed.
    expect(findRate(q.rates, "jnt", "JT")?.cost).toBe(17000);
    expect(findRate(q.rates, "sicepat", "SiCepat")).toBeNull();
  });

  it("PRICES to the district representative always; BOOKS to the picked kelurahan when it has one", async () => {
    config("mengantar");
    seed({ kel: [{ name: "Dago", mengantarAreaId: KEL_AREA }, { name: "Lebakgede", mengantarAreaId: null }] });
    const a = await quoteShipping({ storeId: STORE, destinationId: 325, kelurahan: "  dago ", items: CART });
    // The estimate goes to the REPRESENTATIVE, so the storefront's kelurahan-less rate request and the
    // order's kelurahan-carrying re-quote price the same parcel identically ("shown" == "charged").
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("destination_id")).toBe(current.rep);
    // …while the booking address stamped on the order is the kelurahan.
    expect(a).toMatchObject({ ok: true, destinationAreaId: KEL_AREA });
    fetchMock.mockClear();
    // A kelurahan we never bridged falls back to the representative — never a neighbour village.
    const b = await quoteShipping({ storeId: STORE, destinationId: 326, kelurahan: "Lebakgede", items: CART });
    expect(b).toMatchObject({ ok: true, destinationAreaId: current.rep });
  });

  // A connected store whose Mengantar quote cannot sell anything FALLS BACK to the default provider
  // (owner O6, extended): the shopper gets shipping, the order gets a provider stamp that says which.
  // Each case still proves WHY Mengantar declined (the warn line) and that no Mengantar price leaked.
  async function fellBack(destinationId: number, reason: RegExp, extra: Record<string, unknown> = {}) {
    h.kaShippingPrice.mockResolvedValue(KA_SPX);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const q = await quoteShipping({ storeId: STORE, destinationId, items: CART, ...extra });
    const said = warn.mock.calls.flat().join(" ");
    warn.mockRestore();
    expect(said).toMatch(reason);
    expect(h.kaShippingPrice).toHaveBeenCalledTimes(1);
    expect(q).toMatchObject({ ok: true, provider: "kiriminaja", destinationAreaId: null });
    return q;
  }

  it("district with no Mengantar area → OUR refusal (no provider call) → falls back to the default provider", async () => {
    config("mengantar");
    seed({ rep: null });
    await fellBack(327, /Ongkir belum tersedia untuk kecamatan ini/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no seller Mengantar origin → never a store-city guess → falls back to the default provider", async () => {
    config("mengantar");
    seed({ origin: null });
    await fellBack(328, /Alamat pengambilan toko belum diatur/, { storeCity: "Yogyakarta" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an EMPTY platform courier list prices NOTHING on Mengantar (never 'all allowed') → falls back", async () => {
    config("mengantar");
    seed({ platform: [] });
    await fellBack(329, /no rates/);
  });

  it("a provider refusal or outage falls back too — and the provider's words only reach the log", async () => {
    config("mengantar");
    answer({ success: false, message: "Origin tidak valid untuk akun ini" }, 400);
    const q = await fellBack(330, /Origin tidak valid/);
    expect(JSON.stringify(q)).not.toContain("Origin tidak valid");
    seed(); // fresh area: an error is never cached, but be explicit
    h.kaShippingPrice.mockClear();
    fetchMock.mockImplementation(async () => new Response("<html>502</html>", { status: 502 }));
    await fellBack(331, /.+/);
  });

  it("O6: a store with NO connected Mengantar account falls back to KiriminAja — and the stamp says so", async () => {
    config("mengantar", false);
    h.kaShippingPrice.mockResolvedValue(KA_SPX);
    const q = await quoteShipping({ storeId: STORE, destinationId: 332, items: CART });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.kaShippingPrice).toHaveBeenCalledTimes(1);
    expect(q).toMatchObject({ ok: true, provider: "kiriminaja", destinationAreaId: null, codEnabled: true });
  });

  it("O4/O6: a COD quote ALWAYS goes to KiriminAja, even for a connected store, without opening its account", async () => {
    config("mengantar", true);
    h.kaShippingPrice.mockResolvedValue(KA_SPX);
    const q = await quoteShipping({ storeId: STORE, destinationId: 336, items: CART, cod: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
    expect(q).toMatchObject({ ok: true, provider: "kiriminaja" });
    if (q.ok) expect(q.rates[0]).toMatchObject({ code: "spx", cod: true });
  });

  it("caches per (provider, account, origin, destination, kg) — and never caches an empty answer", async () => {
    config("mengantar");
    const dest = 333;
    await quoteShipping({ storeId: STORE, destinationId: dest, items: CART });
    await quoteShipping({ storeId: STORE, destinationId: dest, items: CART });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await quoteShipping({ storeId: STORE, destinationId: dest, items: [{ variantId: "a", qty: 3 }] }); // 2.1 kg
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const key = mgEstimateCacheKey({ base: "https://x", key: FAKE_KEY }, ORIGIN, DISTRICT_REP, 2);
    expect(key.startsWith("mengantar:")).toBe(true);
    expect(key).not.toContain(FAKE_KEY);
    expect(key).toContain(`:${ORIGIN}:${DISTRICT_REP}:2`);
    expect(mgEstimateCacheKey({ base: "https://x", key: "other-account" }, ORIGIN, DISTRICT_REP, 2)).not.toBe(key);

    seed();
    answer({ success: true, data: {} });
    h.kaShippingPrice.mockResolvedValue(KA_SPX); // an empty Mengantar answer falls back (and is not cached)
    vi.spyOn(console, "warn").mockImplementationOnce(() => {}).mockImplementationOnce(() => {});
    await quoteShipping({ storeId: STORE, destinationId: 334, items: CART });
    await quoteShipping({ storeId: STORE, destinationId: 334, items: CART });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("`couriers` narrows the answer (fast pair) but can never widen past policy", async () => {
    config("mengantar");
    seed({ platform: ["jne"] });
    const q = await quoteShipping({ storeId: STORE, destinationId: 335, items: CART, couriers: ["spx", "jne", "jnt"] });
    if (!q.ok) throw new Error(q.error);
    expect(q.rates.map((r) => r.code)).toEqual(["jne"]);
  });
});

describe("mengantarRates — the courier rule (pure)", () => {
  const rate = (key: string, price = 10000): MgRate => ({
    key, shipment: { courier: key, cargo: false }, group: "regular", price, cost: price - 1000, cod: true, codFee: null, etd: "",
  });
  const all = [rate("JNE"), rate("JT"), rate("spx"), rate("SAP"), rate("SAPLite")]; // SAPLite: no TokoΦ courier (M8) → never quoted
  const codes = (rs: { code: string; type: string }[]) => rs.map((r) => `${r.code}:${r.type}`);

  it("platform ∩ merchant column when the store selected nothing per service", () => {
    expect(codes(mengantarRates(all, { platformOn: ["jne", "spx", "sap"], merchant: ["spx", "sap", "jnt"], picked: [] }))).toEqual([
      "spx:spx", "sap:SAP",
    ]);
  });

  it("a store with only KiriminAja service rows keeps ITS couriers, at every Mengantar service for them", () => {
    const picked = [{ courier: "jne", service: "REG" }, { courier: "spx", service: "1" }];
    expect(codes(mengantarRates(all, { platformOn: ["jne", "spx", "jnt"], merchant: null, picked }))).toEqual(["jne:JNE", "spx:spx"]);
  });

  it("a saved Mengantar selection is exact: only those estimate keys", () => {
    const picked = [{ courier: "sap", service: "SAP" }, { courier: "jne", service: "REG" }];
    expect(codes(mengantarRates(all, { platformOn: ["jne", "sap"], merchant: null, picked }))).toEqual(["sap:SAP"]);
  });

  it("empty platform list = no rates, whatever the store says", () => {
    expect(mengantarRates(all, { platformOn: [], merchant: null, picked: [] })).toEqual([]);
    expect(mengantarRates(all, { platformOn: [], merchant: ["jne"], picked: [{ courier: "jne", service: "JNE" }] })).toEqual([]);
  });

  it("every rate is non-COD and priced at `price`", () => {
    const out = mengantarRates([rate("JNE", 18000)], { platformOn: ["jne"], merchant: null, picked: [] });
    expect(out).toEqual([{ name: "JNE", code: "jne", type: "JNE", cost: 18000, etd: "", cod: false, group: "regular" }]);
  });

  it("never quotes a key with no TokoΦ courier", () => {
    expect(mengantarRates([rate("Ninja"), rate("JNECargo")], { platformOn: ["ninja", "jne"], merchant: null, picked: [] })).toEqual([]);
  });
});
