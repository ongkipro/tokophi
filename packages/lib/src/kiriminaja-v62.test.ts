import { afterEach, describe, expect, it, vi } from "vitest";

// The v6.2 booking contract, pinned against the response KiriminAja ACTUALLY sent.
//
// N40 phase-2 migrated `kaCreateOrder` from `/api/mitra/v6.1/request_pickup` to v6.2. The contract
// investigation (`specs/docs/tasks/2026-08-12-n40-v62-contract.md`) mapped the REQUEST field by
// field against the sandbox's own Go struct, but deliberately left the SUCCESS response unproven —
// proving it needs a real booking. That booking was made once, with the owner's authorisation, on
// 2026-08-20; the body below is what came back, verbatim. It is a fixture rather than a live call
// precisely so nobody has to book again to keep this honest.

const BOOKED = {
  status: true,
  pickup_number: "EPR-1550265486",
  details: [{ order_id: "5758-N2975e1537124", kj_order_id: "5758-N2975e1537124", awb: "", service: "jne", service_type: "REG23" }],
};

const sender = { name: "Toko", phone: "6281234567890", address: "Jl. Malioboro No. 123", kecamatanId: 6138 };
const pkg = {
  orderRef: "N29", destName: "Penerima", destPhone: "6281298765432", destAddress: "Jl. Mampang No. 10",
  destKecamatanId: 2107, weight: 1000, itemValue: 100000, itemName: "Kain",
  service: "jne", serviceType: "REG23", shippingCost: 17000,
};

async function book(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const { kaCreateOrder } = await import("./kiriminaja");
  const res = await kaCreateOrder(sender, pkg, "2026-08-21 10:00:00");
  const call = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
  return { res, url: call[0], sent: JSON.parse(call[1].body) };
}

afterEach(() => vi.unstubAllGlobals());

describe("kaCreateOrder speaks v6.2", () => {
  it("books on the v6.2 path", async () => {
    const { url } = await book(BOOKED);
    expect(url).toContain("/api/mitra/v6.2/request_pickup");
    expect(url).not.toContain("v6.1");
  });

  // `drop` binds as bool in the v6.2 struct and its DEFAULT IS NOT DOCUMENTED. Every booking this
  // product makes is a pickup, and the whole "Resi terbit" flow assumes it — so it is pinned, not
  // left to the vendor.
  it("pins drop=false rather than trusting the vendor default", async () => {
    const { sent } = await book(BOOKED);
    expect(sent.packages[0].drop).toBe(false);
  });

  // The v6.2 doc's table lists `add_cost`; the sandbox struct has no such field. We never sent it.
  it("sends no field the v6.2 struct does not have", async () => {
    const { sent } = await book(BOOKED);
    expect(sent.packages[0]).not.toHaveProperty("add_cost");
    expect(sent.packages[0].package_type_id).toBe(7); // NOT the doc's 9 — undocumented semantics
  });

  // 🔴 THE ONE BEHAVIOUR CHANGE THE BOOKING FOUND. v6.1 answered `awb: null`; v6.2 answers `""`.
  it("an empty-string awb is not a waybill", async () => {
    const { res } = await book(BOOKED);
    expect(res.ok).toBe(true);
    expect(res.kaOrderId).toBe("5758-N2975e1537124");
    expect(res.pickupNumber).toBe("EPR-1550265486");
    expect(res.awb, "an empty string must never reach orders.awb").toBeUndefined();
  });

  it("a real waybill still comes through", async () => {
    const { res } = await book({ ...BOOKED, details: [{ ...BOOKED.details[0], awb: "JP1234567890" }] });
    expect(res.awb).toBe("JP1234567890");
  });

  // v6.2 answers business failures as HTTP 400 with no `method` field, where v6.1 used HTTP 200.
  // `ka()` parses the body regardless of status and we read only `status`/`text` — do not add an
  // HTTP-status check here, or every ordinary refusal becomes a thrown error.
  it("reads a v6.2-shaped refusal from an HTTP 400 body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: false, text: "Jadwal penjemputan tidak lagi tersedia" }), { status: 400, headers: { "content-type": "application/json" } })));
    const { kaCreateOrder } = await import("./kiriminaja");
    const res = await kaCreateOrder(sender, pkg, "2020-01-01 10:00:00");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Jadwal penjemputan tidak lagi tersedia");
  });
});
