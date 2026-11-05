import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHIPPING_QUOTE_UNAVAILABLE } from "@/lib/public-guard";

// SHIP-MENGANTAR — `/api/public/ongkir` keeps its contract while the price producer behind it
// switches provider: the storefront still sends a KiriminAja district id (+ optionally a kelurahan
// NAME), still gets `{ ok, rates, … }`, and a provider's own words still never reach it (ADR 0004).
// The quote is stubbed — what is under test is the ROUTE: what it forwards, what it returns.

const h = vi.hoisted(() => ({
  quoteShipping: vi.fn(),
  shippingConfigured: vi.fn(async () => true),
}));

vi.mock("@tokophi/db", async () => {
  const schemaMod = await import("@tokophi/db/schema");
  const rows = [{ id: "00000000-0000-4000-8000-0000000000aa", city: "Bandung" }];
  const chain = (): unknown => {
    const p = Promise.resolve(rows);
    return { where: chain, limit: chain, then: p.then.bind(p) };
  };
  return { schema: schemaMod, db: { select: () => ({ from: chain }) } };
});
vi.mock("@/lib/data/areas", () => ({ resolveArea: vi.fn(async () => []), kelurahanForDistrict: vi.fn(async () => []) }));
vi.mock("@/lib/shipping-quote", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, quoteShipping: h.quoteShipping, shippingConfigured: h.shippingConfigured };
});

const { POST } = await import("./route");

let ip = 0;
function rates(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/public/ongkir", {
      method: "POST",
      // A fresh IP per request: the route allows 60/min per IP and this must never be what a test measures.
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` },
      body: JSON.stringify({ op: "rates", storeSlug: "toko-test", destinationId: 321, items: [{ handle: "x", variant: "Default", qty: 1 }], ...body }),
    }),
  );
}

beforeEach(() => {
  h.quoteShipping.mockReset();
  h.shippingConfigured.mockReset().mockResolvedValue(true);
});

describe("POST /api/public/ongkir — provider switch (SHIP-MENGANTAR)", () => {
  it("replaces a Mengantar refusal with OUR copy — the provider's words never reach the shopper", async () => {
    const providerWords = "Mengantar: origin_id 5f1d0c tidak valid untuk akun ini";
    h.quoteShipping.mockResolvedValue({ ok: false, error: providerWords, fromProvider: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await rates({});
    const text = await res.text();
    // …but it IS logged, where whoever can fix it will look.
    expect(spy.mock.calls.flat().join(" ")).toContain(providerWords);
    spy.mockRestore();
    expect(text).not.toContain("origin_id");
    expect(text).not.toMatch(/mengantar/i);
    expect(JSON.parse(text)).toEqual({ ok: false, error: SHIPPING_QUOTE_UNAVAILABLE });
  });

  it("keeps OUR own failure text (it is ours to say, and actionable)", async () => {
    h.quoteShipping.mockResolvedValue({ ok: false, error: "Ongkir belum tersedia untuk kecamatan ini." });
    expect(await (await rates({})).json()).toEqual({ ok: false, error: "Ongkir belum tersedia untuk kecamatan ini." });
  });

  it("forwards the district id + kelurahan NAME, never a provider id, and returns the unchanged response shape", async () => {
    h.quoteShipping.mockResolvedValue({
      ok: true,
      rates: [{ name: "JNE", code: "jne", type: "JNE", cost: 18000, etd: "", cod: false, group: "regular" }],
      grams: 700,
      billableGrams: 1000,
      weightFallback: [],
      codEnabled: false,
      provider: "mengantar",
      destinationAreaId: "cccccccccccccccccccccccc",
      origin: 101,
      originFrom: "pickup",
      originName: "Gudang",
    });
    const body = await (await rates({ kelurahan: "Dago", mengantarAreaId: "ffffffffffffffffffffffff" })).json();
    const input = h.quoteShipping.mock.calls[0][0];
    expect(input).toMatchObject({ destinationId: 321, kelurahan: "Dago", couriers: ["spx", "jne"] });
    expect(JSON.stringify(input)).not.toContain("ffffffffffffffffffffffff");
    // Same keys the storefront has always read — no provider, no Mengantar area id leaks out.
    expect(Object.keys(body).sort()).toEqual(
      ["billableWeight", "codEnabled", "codRequote", "ok", "origin", "originFrom", "originName", "rates", "weight", "weightFallback"].sort(),
    );
    expect(JSON.stringify(body)).not.toContain("cccccccccccccccccccccccc");
    expect(JSON.stringify(body)).not.toMatch(/mengantar/i);
    // D12: a quote that cannot carry COD tells the checkout to re-quote when the shopper picks COD.
    expect(body.codRequote).toBe(true);
  });

  it("D12: `cod: true` is forwarded, and a quote from the default route never asks for a re-quote", async () => {
    const ok = { ok: true, rates: [], grams: 700, billableGrams: 1000, weightFallback: [], codEnabled: true, origin: 101, originFrom: "pickup", originName: "Gudang" };
    h.quoteShipping.mockResolvedValue({ ...ok, provider: "kiriminaja" });
    expect((await (await rates({ cod: true })).json()).codRequote).toBe(false);
    expect(h.quoteShipping.mock.calls[0][0]).toMatchObject({ cod: true });
    expect((await (await rates({})).json()).codRequote).toBe(false);
    expect(h.quoteShipping.mock.calls[1][0]).toMatchObject({ cod: false });
    // A truthy-but-not-true value is not a COD request.
    await rates({ cod: "yes" });
    expect(h.quoteShipping.mock.calls[2][0]).toMatchObject({ cod: false });
  });

  it("asks whether the ACTIVE provider is configured, not KiriminAja by name", async () => {
    h.shippingConfigured.mockResolvedValue(false);
    expect(await (await rates({})).json()).toEqual({ ok: false, error: "Shipping belum dikonfigurasi." });
    expect(h.quoteShipping).not.toHaveBeenCalled();
  });
});
