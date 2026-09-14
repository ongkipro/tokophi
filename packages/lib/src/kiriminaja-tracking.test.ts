import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SORTING_CODE_COURIERS,
  courierNeedsSortingCode,
  normalizeSortingCode,
  parseKaTracking,
  realWaybill,
  sortingCodeFromHint,
} from "./kiriminaja-tracking";

// The tracking envelope, pinned against what KiriminAja ACTUALLY returned.
//
// MEASURED 2026-09-14 from the allow-listed production container (sandbox endpoint, read-only,
// shape and non-personal values only): `{ status, text: "Menunggu Pickup", method: "shTracking",
// status_code: 105, details: { awb: "MOCK-<our ref>", sorting_code: null, order_id: <our ref>,
// status_code: null, … }, histories: [] }`. There is NO `data` key, and the sandbox's waybill is a MOCK.
// The awb/order_id below are the measured literals for one UAT parcel (a booking ref, no personal data).
const MEASURED = {
  status: true,
  text: "Menunggu Pickup",
  method: "shTracking",
  status_code: 105,
  details: {
    awb: "MOCK-5758-UAT1080737",
    signature_code: "",
    sorting_code: null,
    order_id: "5758-UAT1080737",
    status_code: null,
    estimation: "-",
    service: "SPX Economy",
    service_name: "3",
    drop: false,
    shipped_at: "",
    delivered: false,
    delivered_at: "",
    refunded: false,
    refunded_at: "",
    images: {},
    costs: {},
    origin: {},
    destination: {},
  },
  histories: [],
};

// The vendor's OpenAPI example — a delivered parcel WITH a sorting code and history.
const SPEC_EXAMPLE = {
  status: true,
  text: "Delivered to BAGUS | 14-07-2021 16:00 | YOGYAKARTA",
  method: "shTracking",
  status_code: 200,
  details: { awb: "DEVEL-000000004", sorting_code: "JOG-JOG1000-JKT2020", order_id: "OID-8793949106", status_code: null },
  histories: [{ created_at: "2021-07-14 16:00:00", status: "Delivered to BAGUS", status_code: 200, driver: "", receiver: "BAGUS" }],
};

describe("parseKaTracking — the real envelope", () => {
  it("reads the waybill and the PACKAGE status code from `details` + top-level `status_code`", () => {
    const t = parseKaTracking(MEASURED);
    expect(t.awb).toBe("MOCK-5758-UAT1080737"); // parsed verbatim — refusing it is realWaybill's job
    expect(t.statusCode).toBe(105);
    expect(t.text).toBe("Menunggu Pickup");
    expect(t.sortingCode).toBeNull(); // the sandbox never issues one
    expect(t.keys).toContain("sorting_code");
  });

  it("reads the spec example: sorting code, delivered code, history", () => {
    const t = parseKaTracking(SPEC_EXAMPLE);
    expect(t.awb).toBe("DEVEL-000000004");
    expect(t.sortingCode).toBe("JOG-JOG1000-JKT2020");
    expect(t.statusCode).toBe(200);
    expect(t.histories).toEqual([{ date: "2021-07-14 16:00:00", desc: "Delivered to BAGUS", statusCode: 200 }]);
  });

  // The regression itself: the old reader cast `body.data`. On the measured body that is undefined.
  it("finds nothing under `data`, because the response has no such key — the bug this module fixes", () => {
    expect((MEASURED as Record<string, unknown>).data).toBeUndefined();
    expect(parseKaTracking(MEASURED).awb).not.toBeNull();
  });

  it("still reads the legacy `data` shape, but `details` wins when both exist", () => {
    expect(parseKaTracking({ status: true, data: { awb: "LEGACY1", status: "dikirim" } })).toMatchObject({ awb: "LEGACY1", statusCode: "dikirim" });
    expect(parseKaTracking({ details: { awb: "REAL" }, data: { awb: "OLD" } }).awb).toBe("REAL");
  });

  it("treats an empty waybill as no waybill, and a garbage body as empty", () => {
    expect(parseKaTracking({ details: { awb: "   " } }).awb).toBeNull();
    for (const b of [null, undefined, "x", 42, [], { details: [] }]) {
      expect(parseKaTracking(b)).toMatchObject({ awb: null, sortingCode: null, statusCode: null, histories: [] });
    }
  });

  it("accepts a numeric status code sent as a string", () => {
    expect(parseKaTracking({ status_code: "200", details: {} }).statusCode).toBe(200);
  });
});

describe("realWaybill — what may be printed as a resi", () => {
  it("refuses the sandbox's MOCK-<ref>, which the old `awb !== ref` test accepted", () => {
    const ref: string = "5758-UAT1080737";
    const mock: string = "MOCK-5758-UAT1080737";
    expect(mock !== ref).toBe(true); // the old guard's verdict: "real"
    expect(realWaybill(mock, ref)).toBeNull();
    expect(realWaybill("MOCK-5758-PHI4970", "5758-PHI4970")).toBeNull();
  });
  it("refuses our own ref, a value containing it, blanks, and marked placeholders", () => {
    expect(realWaybill("5758-UAT1", "5758-UAT1")).toBeNull();
    expect(realWaybill("X-5758-UAT1-Y", "5758-UAT1")).toBeNull();
    for (const a of [null, undefined, "", "  ", "DEMO-123", "demo_123", "TEST 1", "dummy-9"]) expect(realWaybill(a, "5758-X"), String(a)).toBeNull();
  });
  it("passes a courier waybill through, trimmed", () => {
    expect(realWaybill(" SPXID057802455131 ", "5758-UAT1080737")).toBe("SPXID057802455131");
    expect(realWaybill("JP1234567890", null)).toBe("JP1234567890");
    // A real waybill that merely STARTS with letters spelling a word is not a placeholder.
    expect(realWaybill("TESTAWB9", "5758-X")).toBe("TESTAWB9");
  });
});

describe("normalizeSortingCode", () => {
  it("keeps the vendor's own examples verbatim", () => {
    expect(normalizeSortingCode("JOG-JOG1000-JKT2010")).toBe("JOG-JOG1000-JKT2010");
    expect(normalizeSortingCode("  JKT 01 / A.3  ")).toBe("JKT 01 / A.3");
  });

  it("refuses what a sorting hub must never read: empty, markup, control characters, multi-line, oversized", () => {
    const nul = String.fromCharCode(0);
    const newline = String.fromCharCode(10);
    for (const bad of [null, undefined, 42, "", "   ", "<b>JOG</b>", `JOG${nul}X`, `JOG${newline}JKT`, "-JOG", "JOG-", "x".repeat(65), "JOG;DROP"]) {
      expect(normalizeSortingCode(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(normalizeSortingCode("x".repeat(64))).toBe("x".repeat(64));
  });
});

describe("courierNeedsSortingCode — SPX, ID Express, J&T, J&T Cargo (KiriminAja, 2026-09-14)", () => {
  it("is exactly the four courier CODES, case-insensitive", () => {
    expect([...SORTING_CODE_COURIERS]).toEqual(["spx", "idx", "jnt", "jtcargo"]);
    for (const c of ["spx", "SPX", " idx ", "jnt", "jtcargo"]) expect(courierNeedsSortingCode(c), c).toBe(true);
    for (const c of ["jne", "sicepat", "anteraja", "SPX Standard", "", null, undefined]) expect(courierNeedsSortingCode(c), String(c)).toBe(false);
  });
});

describe("sortingCodeFromHint — a webhook row contributes a code only for the waybill we verified", () => {
  const code = "JOG-JOG1000-JKT2010";
  it("accepts the code when the row's awb equals the verified awb", () => {
    expect(sortingCodeFromHint({ hintAwb: "SPX123", hintSortingCode: code, verifiedAwb: "SPX123" })).toBe(code);
  });
  it("refuses it when there is no verified waybill, or the row names a different one", () => {
    expect(sortingCodeFromHint({ hintAwb: "SPX123", hintSortingCode: code, verifiedAwb: null })).toBeNull();
    expect(sortingCodeFromHint({ hintAwb: "SPX999", hintSortingCode: code, verifiedAwb: "SPX123" })).toBeNull();
    expect(sortingCodeFromHint({ hintAwb: undefined, hintSortingCode: code, verifiedAwb: "SPX123" })).toBeNull();
    expect(sortingCodeFromHint({ hintAwb: "", hintSortingCode: code, verifiedAwb: "" })).toBeNull();
  });
  it("still normalises what it accepts", () => {
    expect(sortingCodeFromHint({ hintAwb: "SPX123", hintSortingCode: "<script>", verifiedAwb: "SPX123" })).toBeNull();
  });
});

describe("kaTrack returns the PARSED tracking, never the raw envelope", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("surfaces the waybill and status from the measured response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(MEASURED), { status: 200, headers: { "content-type": "application/json" } })));
    const { kaTrack } = await import("./kiriminaja");
    const r = await kaTrack("5758-UAT1080737");
    expect(r.ok).toBe(true);
    expect(r.tracking?.awb).toBe("MOCK-5758-UAT1080737");
    expect(r.tracking?.statusCode).toBe(105);
    expect(r).not.toHaveProperty("data");
  });
  it("carries no tracking on a vendor refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: false, text: "Tracking tidak tersedia" }), { status: 200, headers: { "content-type": "application/json" } })));
    const { kaTrack } = await import("./kiriminaja");
    const r = await kaTrack("5758-X");
    expect(r).toMatchObject({ ok: false, error: "Tracking tidak tersedia" });
    expect(r.tracking).toBeUndefined();
  });
});
