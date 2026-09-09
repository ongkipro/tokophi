import { describe, expect, it, vi, afterEach } from "vitest";
import { codeOnly, codeOfFile } from "../../../test/source-code";
import { buildKaOrderRef, kaOrderId, kaOrderRefBudget, KA_ORDER_ID_MAX } from "./kiriminaja";

// Task 8.20 — `POST /api/mitra/tracking` declares `order_id` `maxLength: 20` while
// `POST /api/mitra/v6.2/request_pickup` declares none. Every id we mint must fit 20 INCLUDING the
// prefix and its hyphen, or the poller asks tracking for something tracking will not take.
//
// The real production order-number format, measured: `PHI-<9 digits of Date.now()><3 base36>`.
const REAL = "PHI-768771328ISC"; // a genuine production order number, 16 characters
const PROD_PREFIX = "5758"; // KIRIMINAJA_ORDER_PREFIX in production
const FALLBACK_PREFIX = "TOKOPHI"; // the code's own default when the env var is unset

afterEach(() => vi.unstubAllGlobals());

describe("the whole order_id fits the vendor's 20-character tracking limit", () => {
  it("fits with the production prefix, and keeps the order number intact", () => {
    const id = kaOrderId(buildKaOrderRef(REAL, 0, PROD_PREFIX), PROD_PREFIX);
    expect(id).toBe("5758-768771328ISC0");
    expect(id.length).toBe(18);
    expect(id.length).toBeLessThanOrEqual(KA_ORDER_ID_MAX);
    // Traceability: the order number, minus the constant `PHI` the vendor prefix already carries,
    // is readable in the id, so an operator in the KiriminAja CMS can search `orders.number`.
    expect(id).toContain("768771328ISC");
  });

  it("fits with the code's TOKOPHI fallback — exactly 20, nothing over", () => {
    const id = kaOrderId(buildKaOrderRef(REAL, 0, FALLBACK_PREFIX), FALLBACK_PREFIX);
    expect(id).toBe("TOKOPHI-68771328ISC0");
    expect(id.length).toBe(20);
    // Only the slowest-varying timestamp digit is dropped; the 3-char random tail survives whole.
    expect(id).toContain("ISC");
  });

  it("fits for every attempt of every prefix, including a seeded short order number", () => {
    for (const prefix of [PROD_PREFIX, FALLBACK_PREFIX]) {
      for (const number of [REAL, "PHI-4970", "PHI-202951778F2Y"]) {
        for (let attempt = 0; attempt <= 35; attempt++) {
          const id = kaOrderId(buildKaOrderRef(number, attempt, prefix), prefix);
          expect(id.length, `${prefix} / ${number} / attempt ${attempt}`).toBeLessThanOrEqual(KA_ORDER_ID_MAX);
        }
      }
    }
  });

  // THE DEFECT THIS TASK CLOSES, kept as a live self-check so the claim can never be vacuous:
  // the shipped construction was `orderNumber.replace(/[^A-Za-z0-9]/g,"") + bookingId.slice(0,8)`.
  it("the construction it replaced really did breach the limit", () => {
    const old = REAL.replace(/[^A-Za-z0-9]/g, "") + "e1537124"; // 8 chars of a booking UUID
    expect(`${PROD_PREFIX}-${old}`.length).toBe(28);
    expect(`${FALLBACK_PREFIX}-${old}`.length).toBe(31);
    expect(() => kaOrderId(old, PROD_PREFIX)).toThrow(/28 characters/);
  });
});

describe("uniqueness survives the shortening", () => {
  it("repeat bookings of ONE order never reuse a reference", () => {
    for (const prefix of [PROD_PREFIX, FALLBACK_PREFIX]) {
      const refs = Array.from({ length: 36 }, (_, attempt) => buildKaOrderRef(REAL, attempt, prefix));
      expect(new Set(refs).size).toBe(36);
    }
  });

  it("different orders keep different references", () => {
    const a = buildKaOrderRef("PHI-768771328ISC", 0, FALLBACK_PREFIX);
    const b = buildKaOrderRef("PHI-768771328ISD", 0, FALLBACK_PREFIX);
    const c = buildKaOrderRef("PHI-768771329ISC", 0, FALLBACK_PREFIX);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  // The counter is exact, not probabilistic — so it must REFUSE rather than wrap round to 0 and
  // hand the vendor an id that already belongs to an earlier parcel.
  it("refuses a 37th booking of the same order instead of wrapping", () => {
    expect(() => buildKaOrderRef(REAL, 36, PROD_PREFIX)).toThrow(/outside 0\.\.35/);
    expect(() => buildKaOrderRef(REAL, -1, PROD_PREFIX)).toThrow(/outside 0\.\.35/);
  });
});

describe("the guard fails loudly instead of shortening", () => {
  it("refuses a prefix that leaves too little of the order number", () => {
    expect(kaOrderRefBudget("TOKOPHISHIPPING")).toBe(4);
    expect(() => buildKaOrderRef(REAL, 0, "TOKOPHISHIPPING")).toThrow(/leaves only 3 characters/);
  });

  it("kaOrderId throws rather than truncating a reference that is already too long", () => {
    expect(() => kaOrderId("768771328ISCe1537124", PROD_PREFIX)).toThrow(/Refusing to book/);
  });

  it("an order number with no alphanumerics is refused, never sent as an empty reference", () => {
    expect(() => buildKaOrderRef("---", 0, PROD_PREFIX)).toThrow(/carries no identifier/);
  });
});

// The send-time half: `kaCreateOrder` must not put an over-long id on the wire even if a caller
// hands it one. This is the assertion that would have caught the shipped defect at the boundary.
describe("kaCreateOrder cannot put an over-long order_id on the wire", () => {
  async function book(orderRef: string) {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: true, details: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { kaCreateOrder } = await import("./kiriminaja");
    const res = await kaCreateOrder(
      { name: "Toko", phone: "6281234567890", address: "Jl. Malioboro No. 123", kecamatanId: 6138 },
      {
        orderRef,
        destName: "Penerima", destPhone: "6281298765432", destAddress: "Jl. Mampang No. 10",
        destKecamatanId: 2107, weight: 1000, itemValue: 100000, itemName: "Kain",
        service: "jne", serviceType: "REG23", shippingCost: 17000, items: [],
      },
      "2026-08-21 10:00:00",
    );
    const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }] | undefined;
    return { res, sent: call ? JSON.parse(call[1].body) : null };
  }

  it("sends an id inside the limit for a reference this module built", async () => {
    const { sent } = await book(buildKaOrderRef(REAL, 0));
    expect(sent.packages[0].order_id.length).toBeLessThanOrEqual(KA_ORDER_ID_MAX);
  });

  it("throws — and never calls the vendor — for the old 28-character construction", async () => {
    await expect(book("PHI768771328ISCe1537124")).rejects.toThrow(/tracking accepts 20/);
  });
});

// The construction has ONE home now. A guard on the SOURCE, because the defect was the shape of an
// expression: `astro check`, `tsc` and every other test stayed green while the id went out at 28.
describe("the reference is built in one place", () => {
  const shipping = codeOfFile("apps/admin/lib/actions/shipping.ts");

  it("createShipment asks buildKaOrderRef rather than concatenating a UUID slice", () => {
    expect(shipping).toMatch(/buildKaOrderRef\s*\(/);
    // The exact shape that shipped, whitespace-tolerantly: `bookingId.slice(0, 8)` glued onto the
    // stripped order number. `codeOnly` inerts every literal — the REGEX included, which is why the
    // pattern below matches the identifiers around it and not `/[^A-Za-z0-9]/g` itself — so the
    // comment above the call site that quotes the old expression cannot keep this green.
    expect(shipping).not.toMatch(/orderNumber\s*\.\s*replace[\s\S]{0,60}bookingId\s*\.\s*slice/);
  });

  it("this claim can actually fail (mutation self-check)", () => {
    const mutated = codeOnly(
      'const providerReference = `${input.orderNumber.replace(/[^A-Za-z0-9]/g, "")}${bookingId.slice(0, 8)}`;',
    );
    expect(mutated).toMatch(/orderNumber\s*\.\s*replace[\s\S]{0,60}bookingId\s*\.\s*slice/);
  });

  it("kiriminaja.ts never interpolates the prefix past the guard", () => {
    const lib = codeOfFile("packages/lib/src/kiriminaja.ts");
    expect(lib).toMatch(/order_id\s*:\s*kaOrderId\s*\(/);
    expect(lib).not.toMatch(/order_id\s*:\s*`\$\{\s*KA_ORDER_PREFIX/);
  });
});
