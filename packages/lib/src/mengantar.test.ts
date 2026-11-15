import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MengantarNotWhitelistedError,
  MengantarOutcomeUnknownError,
  MengantarPosCodIneligibleError,
  MengantarTransportError,
  mgBalance,
  mgCancel,
  mgCreateOrder,
  mgEstimate,
  mgEtd,
  mgPayUnpaid,
  mgPickupAddresses,
  mgPickupSlot,
  mgSearchArea,
  mgTestConnection,
  mgTrackByCnote,
  mgTrackByOrderId,
  mgUpsertPickupAddress,
  mgSimulate,
  outcomeFromMengantar,
  parseMgTracking,
  mgPickupSlots,
  earliestPickupSlot,
  nextPickupStart,
  shipmentName,
  type MgCallOptions,
  type MgCreateOrderInput,
  type MengantarConfig,
} from "./mengantar";

// The Mengantar client against a MOCKED transport only. Nothing here may ever reach the network —
// the write functions refuse to try under NODE_ENV=test without an injected fetch (last describe
// block). Partner model: every call carries ONE seller's `cfg`; there is no default config.

// A key whose URL-encoded form differs from its raw form, so both redaction paths are exercised.
const KEY = "sk/live+key=AbC 123&x";
const ENC = encodeURIComponent(KEY);
const cfg: MengantarConfig = { env: "sandbox", base: "https://mg.test", key: KEY };

type Call = { url: string; init: RequestInit };
function mockFetch(...responses: Array<Response | (() => Promise<Response>) | Error>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r() : r.clone();
  });
  return { opts: { cfg, fetch: fn as unknown as typeof fetch } satisfies MgCallOptions, calls, fn };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const text = (status: number, body: string) => new Response(body, { status });
/** A fetch that never answers until the client aborts it. */
const hang = () =>
  vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
  ) as unknown as typeof fetch;

const ORDER: MgCreateOrderInput = {
  courier: "JNE",
  pickup: { type: "dropOff", address_id: "a".repeat(24) },
  orders: [
    {
      customerName: "Siti",
      customerPhone: "6281234567890",
      customerAddress: "Jl. Mawar 1",
      customerAddressDataId: "b".repeat(24),
      parcelContent: "Kemeja",
      weight: 1,
      quantity: 1,
      goodsValue: 150000,
      destinationMark: "PHI-123",
    },
  ],
};

const errorOf = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a throw");
};
const leaks = (s: string) => s.includes(KEY) || s.includes(ENC);

describe("transport — key in the path, client-source header", () => {
  it("calls {base}/api/public/{encoded key}/… with x-client-source: directCall", async () => {
    const m = mockFetch(json(200, { success: true, data: [] }));
    await mgPickupAddresses(m.opts);
    expect(m.calls[0].url).toBe(`https://mg.test/api/public/${ENC}/address`);
    expect((m.calls[0].init.headers as Record<string, string>)["x-client-source"]).toBe("directCall");
    expect((m.calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("with no seller key sends nothing and says so", async () => {
    const m = mockFetch(json(200, {}));
    const r = await mgPickupAddresses({ ...m.opts, cfg: { ...cfg, key: "" } });
    expect(r).toMatchObject({ ok: false, httpStatus: 0 });
    expect(m.fn).not.toHaveBeenCalled();
  });
});

describe("the key never appears in any message — raw or URL-encoded", () => {
  const echo = `upstream said ${KEY} at https://mg.test/api/public/${ENC}/order`;
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["network error on a read", () => mgPickupAddresses(mockFetch(new TypeError(`fetch failed: ${echo}`)).opts)],
    ["network error on a write", () => mgCreateOrder(ORDER, mockFetch(new TypeError(`fetch failed: ${echo}`)).opts)],
    ["non-JSON 4xx on a read", () => mgPickupAddresses(mockFetch(text(404, `<html>${echo}</html>`)).opts)],
    ["unreadable 2xx on a write", () => mgCreateOrder(ORDER, mockFetch(text(200, `<html>${echo}</html>`)).opts)],
    ["5xx JSON on a write", () => mgCreateOrder(ORDER, mockFetch(json(502, { message: echo })).opts)],
    ["business 4xx on a read", () => mgSearchArea("bantul", mockFetch(json(400, { success: false, message: echo })).opts)],
    ["business 400 on a write", () => mgCreateOrder(ORDER, mockFetch(json(400, { success: false, message: echo })).opts)],
    ["other 4xx on a write (outcome unknown)", () => mgCreateOrder(ORDER, mockFetch(json(422, { success: false, message: echo })).opts)],
    ["success:false on a 200", () => mgCancel("JNE", ["x"], mockFetch(json(200, { success: false, message: echo })).opts)],
    ["item error inside a green envelope", () => mgCreateOrder(ORDER, mockFetch(json(200, { success: true, data: [{ _id: "e1", status: "error", error: echo }] })).opts)],
    ["test connection over a dead link", () => mgTestConnection(mockFetch(new TypeError(echo)).opts)],
  ];
  for (const [name, run] of cases) {
    it(name, async () => {
      let message: string;
      try {
        const r = (await run()) as { ok: boolean; error?: string };
        expect(r.ok).toBe(false);
        message = r.error ?? "";
      } catch (e) {
        message = (e as Error).message;
        expect((e as Error & { cause?: unknown }).cause).toBeUndefined();
      }
      expect(leaks(message), message).toBe(false);
      expect(message).toContain("[REDACTED]");
    });
  }
});

describe("POST /order — a write we cannot read the outcome of is OutcomeUnknown, never a failure", () => {
  it("timeout", async () => {
    const e = await errorOf(mgCreateOrder(ORDER, { cfg, fetch: hang(), timeoutMs: 20 }));
    expect(e).toBeInstanceOf(MengantarOutcomeUnknownError);
    expect(e.message).toMatch(/timeout/);
  });
  it.each([
    ["network drop", new TypeError("socket hang up")],
    ["502 with JSON", json(502, { message: "Bad gateway" })],
    ["503 with HTML", text(503, "<html>down</html>")],
    ["200 with HTML", text(200, "<html>ok?</html>")],
    ["200 with an empty body", text(200, "")],
    ["200 JSON with no shipment _id", json(200, { success: true, data: [] })],
  ])("%s", async (_n, r) => {
    expect(await errorOf(mgCreateOrder(ORDER, mockFetch(r).opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
  });

  it("the same failures on a READ are a retryable transport error instead", async () => {
    expect(await errorOf(mgPickupAddresses({ cfg, fetch: hang(), timeoutMs: 20 }))).toBeInstanceOf(MengantarTransportError);
    expect(await errorOf(mgPickupAddresses(mockFetch(text(502, "<html/>")).opts))).toBeInstanceOf(MengantarTransportError);
  });

  it("cancel and pay-unpaid are writes too", async () => {
    expect(await errorOf(mgCancel("JNE", ["x"], mockFetch(json(500, {})).opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
    expect(await errorOf(mgPayUnpaid("b1", "JNE", mockFetch(new TypeError("reset")).opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
  });
});

describe("business refusals are returned, not thrown", () => {
  it("JSON 4xx on POST /order → { ok:false, error, httpStatus }", async () => {
    const r = await mgCreateOrder(ORDER, mockFetch(json(400, { success: false, message: "customerPhone tidak valid" })).opts);
    expect(r).toEqual({ ok: false, error: "customerPhone tidak valid", httpStatus: 400 });
  });
  it("409 (concurrent create) is a business answer the caller can back off on", async () => {
    expect(await mgCreateOrder(ORDER, mockFetch(json(409, { message: "Conflict" })).opts)).toMatchObject({ ok: false, httpStatus: 409 });
  });
  it("…but a 409 IDEMPOTENCY_* answer is outcome-unknown (the first request may have booked)", async () => {
    const e = await errorOf(mgCreateOrder(ORDER, mockFetch(json(409, { success: false, code: "IDEMPOTENCY_REQUEST_IN_PROGRESS", message: "in progress" })).opts));
    expect(e).toBeInstanceOf(MengantarOutcomeUnknownError);
  });
  it.each([401, 404, 422, 429])("M2: a %i on a WRITE is outcome-unknown — only a plain 400 is a known no-op", async (status) => {
    expect(await errorOf(mgCreateOrder(ORDER, mockFetch(json(status, { success: false, message: "x" })).opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
    expect(await errorOf(mgCancel("JNE", ["m1"], mockFetch(json(status, { success: false, message: "x" })).opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
  });
  it("JSON 4xx on a read", async () => {
    expect(await mgSearchArea("x", mockFetch(json(422, { message: "keyword?" })).opts)).toEqual({ ok: false, error: "keyword?", httpStatus: 422 });
  });

  it.each([
    ["new_seller", null, null],
    ["insufficient", 70, 82],
    ["blocked", 61.5, 82],
  ] as const)("POS COD 403 %s is parsed into a typed error", async (status, rate, min) => {
    const body = { success: false, status, deliveredRate: rate, minimumDeliveredRate: min, message: "COD not allowed" };
    const e = await errorOf(mgCreateOrder({ ...ORDER, courier: "pos" }, mockFetch(json(403, body)).opts));
    expect(e).toBeInstanceOf(MengantarPosCodIneligibleError);
    expect(e).toMatchObject({ status, deliveredRate: rate, minimumDeliveredRate: min });
  });

  it("403 'Not allowed' is the whitelist error; any other 403 stays a business answer", async () => {
    expect(await errorOf(mgSearchArea("x", mockFetch(json(403, { message: "Not allowed" })).opts))).toBeInstanceOf(MengantarNotWhitelistedError);
    expect(await mgSearchArea("x", mockFetch(json(403, { status: "other", message: "Forbidden" })).opts)).toMatchObject({ ok: false, httpStatus: 403 });
  });
});

describe("mgEstimate — the courier map becomes bookable rates", () => {
  const data = {
    JNE: { price: 12000, estimatedSpecialPrice: 10500, unsupported: false, unsupported_cod: false, estimate_delivery: "2 - 3 days" },
    JNECargo: { price: 40000, unsupported: false },
    SAP: { price: 11000, estimatedSpecialPrice: 9000, unsupported_cod: true },
    SAPLite: { price: 9000, estimatedSpecialPrice: 8000 },
    SapCargo: { price: 30000 },
    spx: { price: 13700, estimatedSpecialPrice: 1, unsupported: false, unsupportedOriginSpx: true },
    anteraja: { price: 15000, unsupported: true },
    pos: { price: 0 },
    paxel: { price: 20000 },
    JT: { price: "14000", estimatedSpecialPrice: "11499", codFee: 499 },
    SiCepat: { price: 13000, unsupportedPickup: true },
    SiCepatCargo: { price: 50000 },
  };

  it("skips cargo, unsupported (incl. SiCepat's pickup flags), SAPLite (M8), a zero price and unknown keys; cost = special − codFee (M6)", async () => {
    const m = mockFetch(json(200, { success: true, data }));
    const r = await mgEstimate({ originId: "o".repeat(24), destinationId: "d".repeat(24), kg: 1.5 }, m.opts);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.map((x) => x.key)).toEqual(["JNE", "SAP", "JT"]);
    const by = Object.fromEntries(r.data.map((x) => [x.key, x]));
    expect(by.JNE).toMatchObject({ price: 12000, cost: 10500, cod: true, group: "regular", etd: "2-3", shipment: { courier: "JNE", cargo: false } });
    expect(by.SAP).toMatchObject({ price: 11000, cost: 9000, cod: false, shipment: { courier: "Sap", cargo: false } });
    expect(by.JT).toMatchObject({ price: 14000, cost: 11000, codFee: 499 });
    for (const x of r.data) expect(x.price).not.toBe(x.cost);

    const u = new URL(m.calls[0].url);
    expect(Object.fromEntries(u.searchParams)).toEqual({ origin_id: "o".repeat(24), destination_id: "d".repeat(24), courier: "all", weight: "1.5" });
  });

  it("sends COD_AMOUNT only when asked, and refuses a bad weight without a call", async () => {
    const m = mockFetch(json(200, { success: true, data: {} }));
    await mgEstimate({ originId: "o", destinationId: "d", kg: 1, codAmount: 250000 }, m.opts);
    expect(new URL(m.calls[0].url).searchParams.get("COD_AMOUNT")).toBe("250000");
    expect(await mgEstimate({ originId: "o", destinationId: "d", kg: 0 }, m.opts)).toMatchObject({ ok: false, httpStatus: 0 });
    expect(m.fn).toHaveBeenCalledTimes(1);
  });
});

describe("mgEtd — Mengantar ETD text becomes KiriminAja's \"2-3\" shape", () => {
  // Every string below is one the sandbox returned on 2026-11-11 (one /order/estimate answer).
  it.each([
    ["1 - 2 days", "1-2"],
    ["1 - 2 Days", "1-2"],
    ["2 - 4 Hari", "2-4"],
    ["2-3 Day", "2-3"],
    ["2 HARI", "2"],
    ["2 - 5 days", "2-5"],
    ["3 s/d 3 hari", "3"],
    ["2-1", "1-2"],
    ["3 - 2 hari", "2-3"],
  ])("%s → %s", (raw, want) => expect(mgEtd(raw)).toBe(want));

  it("anything that is not a day count is empty — never a guessed number", () => {
    for (const raw of ["", "  ", null, undefined, 3, "besok", "2026-11-13", "13/11/2026", "100 - 200 days"]) expect(mgEtd(raw)).toBe("");
  });
});

describe("shipmentName — the ONE estimate-key → booking-name map", () => {
  it.each([
    ["SAP", { courier: "Sap", cargo: false }],
    ["SapCargo", { courier: "Sap", cargo: true }],
    ["JNE", { courier: "JNE", cargo: false }],
    ["JNECargo", { courier: "JNE", cargo: true }],
    ["SiCepat", { courier: "SiCepat", cargo: false }],
    ["SiCepatCargo", { courier: "SiCepat", cargo: true }],
    ["iDexpress", { courier: "iDexpress", cargo: false }],
    ["iDexpressCargo", { courier: "iDexpress", cargo: true }],
    ["JT", { courier: "JT", cargo: false }],
    ["lion", { courier: "lion", cargo: false }],
    ["anteraja", { courier: "anteraja", cargo: false }],
    ["pos", { courier: "pos", cargo: false }],
    ["spx", { courier: "spx", cargo: false }],
    ["SPX", { courier: "spx", cargo: false }],
  ])("%s → %o", (key, expected) => expect(shipmentName(key)).toEqual(expected));

  it.each(["Ninja", "paxel", "SAPLite", "", "   ", null, undefined])("unknown / unbookable %s → null", (k) => expect(shipmentName(k)).toBeNull());
});

describe("mgCreateOrder — booking", () => {
  it("returns id, ORDER_ID, batch id + code, waybill and isPaid; sends the idempotency header", async () => {
    const m = mockFetch(json(200, { success: true, batch_id: "B1", data: [{ _id: "m1", ORDER_ID: "MGT-9", cnote_no: "JNE123", isPaid: true, batch_id: "B1", batch: "BATCH-CODE", destinationMark: "PHI-123" }] }));
    expect(await mgCreateOrder(ORDER, { ...m.opts, idempotencyKey: "tokophi-booking-1" })).toEqual({
      ok: true,
      data: { id: "m1", orderId: "MGT-9", batchId: "B1", batchCode: "BATCH-CODE", cnoteNo: "JNE123", isPaid: true },
    });
    expect(JSON.parse(String(m.calls[0].init.body))).toEqual(ORDER);
    expect(m.calls[0].init.method).toBe("POST");
    expect((m.calls[0].init.headers as Record<string, string>).idempotencyKey).toBe("tokophi-booking-1");
  });

  it("refuses a malformed idempotency key before anything is sent", async () => {
    const m = mockFetch(json(200, {}));
    expect(await mgCreateOrder(ORDER, { ...m.opts, idempotencyKey: "x".repeat(51) })).toMatchObject({ ok: false, httpStatus: 0 });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("a low wallet is NOT a failure: isPaid false, waybill null", async () => {
    const m = mockFetch(json(200, { success: true, data: [{ _id: "m2", ORDER_ID: "MGT-10", cnote_no: null, isPaid: false }], batch_id: "B2" }));
    expect(await mgCreateOrder(ORDER, m.opts)).toEqual({ ok: true, data: { id: "m2", orderId: "MGT-10", batchId: "B2", batchCode: "", cnoteNo: null, isPaid: false } });
  });

  it("M1: a green envelope with an item status:error and no ORDER_ID is a REFUSAL, not a booking", async () => {
    const m = mockFetch(json(200, { success: true, data: [{ _id: "err1", status: "error", error: "{}", isPaid: true, isPreviouslyError: true }] }));
    expect(await mgCreateOrder(ORDER, m.opts)).toMatchObject({ ok: false, httpStatus: 200 });
  });

  it("an item echoing ANOTHER order's destinationMark is outcome-unknown", async () => {
    const m = mockFetch(json(200, { success: true, data: [{ _id: "m3", ORDER_ID: "MGT-11", destinationMark: "PHI-999" }] }));
    expect(await errorOf(mgCreateOrder(ORDER, m.opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
  });

  it("M13: a scheduled pickup without a volume is refused before anything is sent", async () => {
    const m = mockFetch(json(200, {}));
    const bad = { ...ORDER, pickup: { type: "scheduledPickup", address_id: "a", time_id: "t" } } as unknown as MgCreateOrderInput;
    expect(await mgCreateOrder(bad, m.opts)).toMatchObject({ ok: false, httpStatus: 0 });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("refuses an ESTIMATE key as a booking courier before anything is sent (trap 1)", async () => {
    const m = mockFetch(json(200, {}));
    expect(await mgCreateOrder({ ...ORDER, courier: "SAP" }, m.opts)).toMatchObject({ ok: false, httpStatus: 0 });
    expect(m.fn).not.toHaveBeenCalled();
  });

  it("cancel sends {courier, ids} as DELETE /order and reads deletedCount (M5)", async () => {
    const m = mockFetch(json(200, { success: true, deletedCount: 1 }));
    expect(await mgCancel("JNE", [" m1 "], m.opts)).toEqual({ ok: true, data: { deleted: 1 } });
    expect(m.calls[0].init.method).toBe("DELETE");
    expect(JSON.parse(String(m.calls[0].init.body))).toEqual({ courier: "JNE", ids: ["m1"] });
  });

  it("cancel with deletedCount 0 (silently skipped after pickup) is a refusal; an unreadable count is outcome-unknown", async () => {
    expect(await mgCancel("JNE", ["m1"], mockFetch(json(200, { success: true, deletedCount: 0 })).opts)).toMatchObject({ ok: false });
    expect(await errorOf(mgCancel("JNE", ["m1"], mockFetch(json(200, { success: true })).opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
  });

  it("pay-unpaid reads the paid count + waybills (M4); 0 is a refusal; unreadable is outcome-unknown", async () => {
    const m = mockFetch(json(200, { success: true, data: 2, cnote_no: ["JT1", "JT2"] }));
    expect(await mgPayUnpaid("B1", "JT", m.opts)).toEqual({ ok: true, data: { paid: 2, cnotes: ["JT1", "JT2"] } });
    expect(JSON.parse(String(m.calls[0].init.body))).toEqual({ batch_id: "B1", courier: "JT" });
    expect(await mgPayUnpaid("B1", "JT", mockFetch(json(200, { success: true, data: 0 })).opts)).toMatchObject({ ok: false });
    expect(await errorOf(mgPayUnpaid("B1", "JT", mockFetch(json(200, { success: true, data: true })).opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
  });

  it("simulation is sandbox-only: a production config is refused without a call", async () => {
    const m = mockFetch(json(200, { success: true, data: { statusCategory: "DELIVERED" } }));
    expect(await mgSimulate({ courier: "JT", orderId: "MGT-1", statusCategory: "DELIVERED" }, { ...m.opts, cfg: { ...cfg, env: "production" } })).toMatchObject({ ok: false, httpStatus: 0 });
    expect(m.fn).not.toHaveBeenCalled();
    expect(await mgSimulate({ courier: "JT", orderId: "MGT-1", statusCategory: "DELIVERED" }, m.opts)).toEqual({ ok: true, data: { statusCategory: "DELIVERED" } });
  });
});

describe("pickup addresses and slots", () => {
  const input = { name: "Toko A", pic: "Ani", picPhone: "0812-000", address: "Jl. A 1", areaId: "c".repeat(24) };

  it("upsert reads the _id from the answer, JSON body as documented (sandbox-proven 2026-11-11)", async () => {
    const m = mockFetch(json(200, { success: true, data: { _id: "addr1" } }));
    expect(await mgUpsertPickupAddress(input, m.opts)).toEqual({ ok: true, data: "addr1" });
    expect((m.calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(m.calls[0].init.body)).PICKUP_AUTOFILL).toBe("c".repeat(24));
  });

  it("upsert re-lists when the answer has no _id and matches name + phone + address", async () => {
    const m = mockFetch(
      json(200, { success: true, data: {} }),
      json(200, { success: true, data: [{ _id: "other", PICKUP_NAME: "X" }, { _id: "addr2", PICKUP_NAME: "toko a", PICKUP_PIC_PHONE: "0812000", PICKUP_ADDRESS: "Jl A 1" }] }),
    );
    expect(await mgUpsertPickupAddress(input, m.opts)).toEqual({ ok: true, data: "addr2" });
    expect(m.calls[1].url).toMatch(/\/address$/);
  });

  it("upsert accepted but unidentifiable is outcome-unknown", async () => {
    const m = mockFetch(json(200, { success: true, data: {} }), json(200, { success: true, data: [] }));
    expect(await errorOf(mgUpsertPickupAddress(input, m.opts))).toBeInstanceOf(MengantarOutcomeUnknownError);
  });

  const now = Date.parse("2026-11-10T08:00:00+07:00");
  it("re-uses an existing slot (hour compared numerically) without a POST", async () => {
    const m = mockFetch(json(200, { success: true, data: [{ _id: "t9", date: "11-11-2026", time: "09:00", address: { _id: "addr1" } }] }));
    expect(await mgPickupSlot("addr1", "2026-11-11", 9, { ...m.opts, now })).toEqual({ ok: true, data: "t9" });
    expect(m.fn).toHaveBeenCalledTimes(1);
    expect(m.calls[0].init.method).toBe("GET");
    // M10: documented with NO query parameters.
    expect(new URL(m.calls[0].url).search).toBe("");
  });

  it("M11: an epoch-ms slot date (what GET /time documents) is matched, not dropped", async () => {
    const m = mockFetch(json(200, { success: true, data: [{ _id: "t10", date: Date.parse("2026-11-11T10:00:00Z"), time: "10:00", address: "addr1" }] }));
    expect(await mgPickupSlot("addr1", "2026-11-11", 10, { ...m.opts, now })).toEqual({ ok: true, data: "t10" });
    expect(m.fn).toHaveBeenCalledTimes(1);
  });

  it("creates a slot with mm-dd-yyyy when none exists — JSON body, answer names the address (sandbox shape 2026-11-11)", async () => {
    const m = mockFetch(json(200, { success: true, data: [] }), json(200, { success: true, data: { _id: "t13", date: "2026-11-11T00:00:00.000Z", time: "13:00", address: { _id: "addr1" } } }));
    expect(await mgPickupSlot("addr1", "2026-11-11", 13, { ...m.opts, now })).toEqual({ ok: true, data: "t13" });
    expect((m.calls[1].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(m.calls[1].init.body))).toEqual({ address_id: "addr1", date: "11-11-2026", time: "13:00" });
  });

  it("sends the hour ZERO-PADDED — the provider refuses 9:00 (Time allowed 09:00, …; sandbox 2026-11-11)", async () => {
    const m = mockFetch(json(200, { success: true, data: [] }), json(200, { success: true, data: { _id: "t9p", date: "2026-11-11T00:00:00.000Z", time: "09:00", address: { _id: "addr1" } } }));
    expect(await mgPickupSlot("addr1", "2026-11-11", 9, { ...m.opts, now })).toEqual({ ok: true, data: "t9p" });
    expect(JSON.parse(String(m.calls[1].init.body)).time).toBe("09:00");
  });

  it("never re-uses a GET /time row that does not NAME this address — it may be the old pickup door", async () => {
    // Documented + measured: GET rows are only {_id, date, time}. Same date and hour, no address → a new slot.
    const m = mockFetch(
      json(200, { success: true, data: [{ _id: "old-door", date: "11-11-2026", time: "13:00" }] }),
      json(200, { success: true, data: { _id: "t13b", date: "2026-11-11T00:00:00.000Z", time: "13:00", address: { _id: "addr1" } } }),
    );
    expect(await mgPickupSlot("addr1", "2026-11-11", 13, { ...m.opts, now })).toEqual({ ok: true, data: "t13b" });
    expect(m.calls.map((c) => c.init.method)).toEqual(["GET", "POST"]);
  });

  it.each([
    ["an hour outside 9–18", "2026-11-11", 19],
    ["a slot under 90 minutes ahead", "2026-11-10", 9],
    ["a date that does not exist", "2026-02-30", 10],
  ])("refuses %s without a call", async (_n, date, hour) => {
    const m = mockFetch(json(200, {}));
    expect(await mgPickupSlot("addr1", date, hour, { ...m.opts, now })).toMatchObject({ ok: false, httpStatus: 0 });
    expect(m.fn).not.toHaveBeenCalled();
  });
});

describe("tracking, balance, test connection", () => {
  it("parses the flag-JSON status once, and keeps history as sent", async () => {
    const m = mockFetch(
      json(200, {
        success: true,
        data: [{ cnote_no: "JNE1", ORDER_ID: "MGT-1", courier: "JNE", status: '{"DELIVERED_COMPLETED":true,"PICKED_UP":true,"RTS":false}', history: [{ desc: "Delivered", date: "02-11-2026 10:00" }] }],
      }),
    );
    const r = await mgTrackByCnote("JNE1", m.opts);
    expect(r).toEqual({
      ok: true,
      data: { cnoteNo: "JNE1", orderId: "MGT-1", id: null, batchId: null, isPaid: null, destinationMark: null, courier: "JNE", flags: ["DELIVERED_COMPLETED", "PICKED_UP"], outcome: "delivered", histories: [{ desc: "Delivered", date: "02-11-2026 10:00" }] },
    });
    expect(new URL(m.calls[0].url).searchParams.get("tracking_id")).toBe("JNE1");
  });

  it("by ORDER_ID, and no row → data null", async () => {
    const m = mockFetch(json(200, { success: true, data: [] }));
    expect(await mgTrackByOrderId("MGT-2", m.opts)).toEqual({ ok: true, data: null });
    expect(new URL(m.calls[0].url).searchParams.get("order_id")).toBe("MGT-2");
  });

  it("🔴 a waybill without a movement status is not 'shipped' (risk R5)", () => {
    expect(parseMgTracking({ cnote_no: "JNE9", status: '{"PENDING_PICKUP":true}' }).outcome).toBe("booked");
    expect(parseMgTracking({ cnote_no: "JNE9" }).outcome).toBeNull();
    expect(parseMgTracking({ cnote_no: "JNE9", status: "{}" }).outcome).toBeNull();
  });

  it("balance from GET /invoices?size=1, top-level only (M20)", async () => {
    const m = mockFetch(json(200, { success: true, data: [], balance: 1250000 }));
    expect(await mgBalance(m.opts)).toEqual({ ok: true, data: { balance: 1250000 } });
    expect(new URL(m.calls[0].url).searchParams.get("size")).toBe("1");
    expect(await mgBalance(mockFetch(json(200, { success: true, data: { balance: 5 } })).opts)).toEqual({ ok: true, data: { balance: null } });
  });

  it("M14: statusCategory decides over a plain sandbox status string", () => {
    expect(parseMgTracking({ status: "active", statusCategory: "ON DELIVERY" }).outcome).toBe("shipped");
    expect(parseMgTracking({ status: "active", statusCategory: "DELIVERED" })).toMatchObject({ outcome: "delivered", flags: ["DELIVERED"] });
    expect(parseMgTracking({ status: "active" }).outcome).toBeNull();
    // Production flag-JSON still parses when no category is sent.
    expect(parseMgTracking({ status: '{"DELIVERED_COMPLETED":true}' }).outcome).toBe("delivered");
  });

  it("test connection is a read and never throws", async () => {
    const ok = mockFetch(json(200, { success: true, data: [{ _id: "a1" }] }));
    expect(await mgTestConnection(ok.opts)).toEqual({ ok: true, data: { pickupAddresses: 1 } });
    expect(ok.calls[0].init.method).toBe("GET");
    expect(await mgTestConnection(mockFetch(text(502, "<html/>")).opts)).toMatchObject({ ok: false });
  });
});

describe("public docs audit 2026-11-11 — tracking vocabulary and deleted rows", () => {
  it("DELIVERED_PENDING (documented status key) is delivered, as a flag and as a category", () => {
    expect(outcomeFromMengantar('{"DELIVERED_PENDING":true,"PICKED_UP":true}')).toBe("delivered");
    expect(outcomeFromMengantar("DELIVERED PENDING")).toBe("delivered");
  });

  it("a row with isDeleted: true is a deleted shipment → not found, never its stale status", async () => {
    const m = mockFetch(json(200, { success: true, data: [{ cnote_no: "JNEDEL", ORDER_ID: "MGT-D", statusCategory: "PICKED UP", isDeleted: true }] }));
    expect(await mgTrackByCnote("JNEDEL", m.opts)).toEqual({ ok: true, data: null });
  });
});

describe("outcomeFromMengantar — status category / flags → the shared outcome", () => {
  it.each([
    ["PENDING PICKUP", "booked"],
    ["PICKED UP", "shipped"],
    ["ON DELIVERY", "shipped"],
    ["DELIVERED", "delivered"],
    ["RTS", "returned"],
    ["CANCELED", "canceled"],
    ["CANCELLED", "canceled"],
    ["UNDELIVERED", "problem"],
    ["PICKUP FAILED", "problem"],
    ["ERROR", "problem"],
    ["DELIVERY COURIER", "shipped"],
    ["PICKUP_FAILED_API", "problem"],
    ["LOST", "problem"],
    ["ACTIVE/WAITING NEXT PROCESS", null],
    ["  picked up ", "shipped"],
    ["PICKED_UP", "shipped"],
    ['{"DELIVERED_COMPLETED":true}', "delivered"],
    ['{"PENDING_PICKUP":true}', "booked"],
    ['{"RTS_ON_PROCESS":true}', "returned"],
    ['{"DELIVERY PROBLEM":true}', "problem"],
    ['{"PICKED_UP":true,"DELIVERED":true}', "delivered"],
    ['{"DELIVERED":true,"RTS":true}', "returned"],
    ['{"DELIVERED":false}', null],
  ] as const)("%s → %s", (input, expected) => expect(outcomeFromMengantar(input)).toBe(expected));

  it("takes a parsed flag object too", () => {
    expect(outcomeFromMengantar({ ON_DELIVERY: true })).toBe("shipped");
  });

  it.each([null, undefined, "", "   ", "garbage", "{not json", "[]", "PICKUP", "MANIFESTED", "DELIVEREDX", 42, [], {}, { DELIVERED: "yes" }])(
    "garbage %j → null",
    (input) => expect(outcomeFromMengantar(input)).toBeNull(),
  );
});

describe("🔴 NODE_ENV=test — a write without an injected fetch can never reach production", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("vitest runs this file under NODE_ENV=test (otherwise the refusal below proves nothing)", () => {
    expect(process.env.NODE_ENV).toBe("test");
  });

  const writes: Array<[string, (o: MgCallOptions) => Promise<unknown>]> = [
    ["mgCreateOrder", (o) => mgCreateOrder(ORDER, o)],
    ["mgPayUnpaid", (o) => mgPayUnpaid("B1", "JNE", o)],
    ["mgCancel", (o) => mgCancel("JNE", ["m1"], o)],
    ["mgUpsertPickupAddress", (o) => mgUpsertPickupAddress({ name: "a", pic: "b", picPhone: "1", address: "c", areaId: "d" }, o)],
    ["mgPickupSlot", (o) => mgPickupSlot("addr1", "2099-01-02", 10, o)],
    ["mgSimulate", (o) => mgSimulate({ courier: "JT", orderId: "x", statusCategory: "DELIVERED" }, o)],
  ];
  for (const [name, run] of writes) {
    it(`${name} refuses and the global fetch is never touched`, async () => {
      const spy = vi.fn(async () => json(200, { success: true, data: [{ _id: "x" }] }));
      vi.stubGlobal("fetch", spy);
      const e = await errorOf(run({ cfg }));
      expect(e.message).toMatch(/refused/);
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it("a READ is not refused (it uses the global fetch, mocked here)", async () => {
    const spy = vi.fn(async () => json(200, { success: true, data: [] }));
    vi.stubGlobal("fetch", spy);
    expect(await mgPickupAddresses({ cfg })).toEqual({ ok: true, data: [] });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("pickup schedule — read the provider's slots, pick the earliest bookable one", () => {
  // 2026-11-05 08:00 WIB
  const now = new Date("2026-11-05T08:00:00+07:00").getTime();

  it("normalises GET /time rows (mm-dd-yyyy, 9:00 or 09:00) and drops anything unreadable or off-grid", async () => {
    const m = mockFetch(
      json(200, {
        success: true,
        data: [
          { _id: "s1", date: "11-05-2026", time: "9:00", address: { _id: "addr1" } },
          { _id: "s2", date: "11-06-2026", time: "10:00", address_id: "addr1" },
          { _id: "s3", date: "2026-11-05", time: "13:00", address: "addr1" },
          { _id: "bad1", date: "13-45-2026", time: "10:00", address: "addr1" },
          { _id: "bad2", date: "11-05-2026", time: "19:00", address: "addr1" },
          { _id: "bad3", date: "11-05-2026", time: "10:30", address: "addr1" },
          { date: "11-05-2026", time: "11:00", address: "addr1" },
          { _id: "no-addr", date: "11-05-2026", time: "12:00" },
          { _id: "other-addr", date: "11-05-2026", time: "14:00", address: { _id: "addr2" } },
          { _id: "s4", date: Date.parse("2026-11-07T15:00:00Z"), time: "15:00", address: { _id: "addr1" } },
        ],
      }),
    );
    const r = await mgPickupSlots("addr1", m.opts);
    expect(r.ok && r.data.map((x) => [x.id, x.date, x.hour])).toEqual([
      ["s1", "2026-11-05", 9],
      ["s2", "2026-11-06", 10],
      ["s3", "2026-11-05", 13],
      ["s4", "2026-11-07", 15],
    ]);
    expect(new URL(m.calls[0].url).search).toBe("");
  });

  it("earliest BOOKABLE slot: a slot under 90 min away is skipped, the soonest after it wins", () => {
    const at = (date: string, hour: number, id: string) => ({ id, date, hour, startsAt: new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+07:00`).getTime() });
    const rows = [at("2026-11-06", 10, "tomorrow"), at("2026-11-05", 9, "too-soon"), at("2026-11-05", 13, "today")];
    expect(earliestPickupSlot(rows, now)?.id).toBe("today");
    expect(earliestPickupSlot([at("2026-11-05", 9, "too-soon")], now)).toBeNull();
  });

  it("nextPickupStart follows the documented rule: 09–18 WIB, ≥ 90 min ahead, rolls to tomorrow 09:00", () => {
    expect(nextPickupStart(now)).toMatchObject({ date: "2026-11-05", hour: 10 }); // 08:00 + 90 min → 10:00
    expect(nextPickupStart(new Date("2026-11-05T16:30:00+07:00").getTime())).toMatchObject({ date: "2026-11-05", hour: 18 });
    expect(nextPickupStart(new Date("2026-11-05T16:30:01+07:00").getTime())).toMatchObject({ date: "2026-11-06", hour: 9 });
    expect(nextPickupStart(new Date("2026-11-05T02:00:00+07:00").getTime())).toMatchObject({ date: "2026-11-05", hour: 9 });
  });
});
