import { afterEach, describe, expect, it, vi } from "vitest";
import type { KaPackage, KaSender } from "./kiriminaja";

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

const sender: KaSender = { name: "Toko", phone: "6281234567890", address: "Jl. Malioboro No. 123", kecamatanId: 6138, zipcode: "55271" };
// Two real lines, not one synthetic one — that is the whole point of `items` (Task 8.14).
const items: KaPackage["items"] = [
  { name: "Kain Batik Tulis", price: 250000, weight: 400, qty: 2, width: 20, length: 30, height: 5 },
  { name: "Selendang", price: 75000, weight: 150, qty: 1, width: 20, length: 30, height: 5 },
];
const pkg: KaPackage = {
  orderRef: "N29", destName: "Penerima", destPhone: "6281298765432", destAddress: "Jl. Mampang No. 10",
  destKecamatanId: 2107, weight: 1000, itemValue: 100000, itemName: "Kain",
  service: "jne", serviceType: "REG23", shippingCost: 17000,
  destZipcode: "12790", items,
};

async function book(body: unknown, over: { sender?: Partial<typeof sender>; pkg?: Partial<typeof pkg> } = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const { kaCreateOrder } = await import("./kiriminaja");
  const res = await kaCreateOrder({ ...sender, ...over.sender }, { ...pkg, ...over.pkg }, "2026-08-21 10:00:00");
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

  // ── Task 8.14: the fields the v6.2 spec marks REQUIRED ──────────────────────────────────────
  // The sandbox books successfully without them, so nothing here is enforced by the server today.
  // That is a grace period, not a contract, and these assertions are what keeps the payload honest
  // when it ends.
  it("sends both postal codes as their own fields", async () => {
    const { sent } = await book(BOOKED);
    expect(sent.zipcode, "sender zipcode — store_settings.sender_postcode").toBe("55271");
    expect(sent.packages[0].destination_zipcode, "the shopper's kodepos, required at checkout since 2026-08-03").toBe("12790");
  });

  // A postal code we do not hold is OMITTED. "" / "00000" is a value a sorting hub would act on,
  // and the omission is what books successfully today.
  it("omits a postcode it does not have rather than inventing one", async () => {
    const { sent } = await book(BOOKED, { sender: { zipcode: null }, pkg: { destZipcode: undefined } });
    expect(sent).not.toHaveProperty("zipcode");
    expect(sent.packages[0]).not.toHaveProperty("destination_zipcode");
  });

  it("sends items — the order's real lines, priced PER UNIT", async () => {
    const { sent } = await book(BOOKED);
    expect(sent.packages[0].items).toEqual(items);
    // Not one synthetic line: `item_name` is already that, and a manifest that says "Pesanan …"
    // tells a customs desk or a claims officer nothing about what is in the box.
    expect(sent.packages[0].items).toHaveLength(2);
    expect(sent.packages[0].item_name).toBe("Kain");
  });

  // KiriminAja's UAT review (2026-09-14): the package `qty` is the SUM of `items[].qty`, never 1.
  it("derives the package qty from the manifest", async () => {
    const { sent } = await book(BOOKED);
    expect(sent.packages[0].qty).toBe(3); // 2 + 1
    const noLines = await book(BOOKED, { pkg: { items: [], qty: 4 } });
    expect(noLines.sent.packages[0].qty).toBe(4);
  });

  it("omits items rather than sending an empty array (the schema says minItems: 1)", async () => {
    const { sent } = await book(BOOKED, { pkg: { items: [] } });
    expect(sent.packages[0]).not.toHaveProperty("items");
  });

  // ── Coordinates (0109, KiriminAja's UAT review 2026-09-14) ──────────────────────────────────
  // The spec marks all four REQUIRED. What we hold is a CENTROID (kelurahan, else district) from
  // `resolveAreaCoords`; the client sends it when given and omits it when not — never 0,0, which
  // is a real point in the Gulf of Guinea, not "unknown".
  it("sends both coordinate pairs when it has them", async () => {
    const { sent } = await book(BOOKED, {
      sender: { latitude: -7.2729, longitude: 112.7495 },
      pkg: { destLatitude: -6.2493, destLongitude: 106.8248 },
    });
    expect(sent.latitude).toBe(-7.2729);
    expect(sent.longitude).toBe(112.7495);
    expect(sent.packages[0].destination_latitude).toBe(-6.2493);
    expect(sent.packages[0].destination_longitude).toBe(106.8248);
  });

  it("omits coordinates it does not have — never zeroes", async () => {
    const { sent } = await book(BOOKED);
    for (const k of ["latitude", "longitude"]) expect(sent, `sender ${k} must be absent, not 0`).not.toHaveProperty(k);
    for (const k of ["destination_latitude", "destination_longitude"]) expect(sent.packages[0], `${k} must be absent, not 0`).not.toHaveProperty(k);
    expect(JSON.stringify(sent)).not.toMatch(/latitude|longitude/);
  });

  it("refuses 0,0, a lone coordinate, and a point outside Indonesia", async () => {
    const { coordFields } = await import("./kiriminaja");
    expect(() => coordFields("latitude", 0, 0)).toThrow(/0,0/);
    expect(() => coordFields("destination_latitude", -7.2, null)).toThrow(/both or neither/i);
    // lat/lng swapped — the classic unit bug — lands in the Indian Ocean far south of Java.
    expect(() => coordFields("latitude", 112.7495, -7.2729)).toThrow(/outside Indonesia/);
    expect(coordFields("latitude", null, undefined)).toEqual({});
    expect(coordFields("destination_latitude", -6.2493, 106.8248)).toEqual({ destination_latitude: -6.2493, destination_longitude: 106.8248 });
  });

  it("sends items[].metadata with only the keys that carry a value, and the package note", async () => {
    const { sent } = await book(BOOKED, {
      pkg: {
        note: "  Titip di satpam  ",
        items: [
          { ...items[0], metadata: { sku: "BTK-001", variant_label: "Merah / L" } },
          { ...items[1], metadata: { sku: null, variant_label: null } },
        ],
      },
    });
    expect(sent.packages[0].note).toBe("Titip di satpam");
    expect(sent.packages[0].items[0].metadata).toEqual({ sku: "BTK-001", variant_label: "Merah / L" });
    expect(sent.packages[0].items[1]).not.toHaveProperty("metadata");
  });

  // Two ids exist for one village: `kelurahan.id` is a KEMENDAGRI code (text, dotted) and
  // `kelurahan.ka_kelurahan_id` is KiriminAja's own (Task 8.17, migration 0107). Only the second
  // may be sent. Since 8.17 the Seller's pickup form writes the vendor id into
  // `sender_kelurahan_id`; the DESTINATION half still has no producer (`orders` carries no
  // kelurahan column), so `destKelurahanId` is undefined in practice. Both stay CONDITIONAL —
  // NULL means omit. The guard that refuses a Kemendagri code is `ka-kelurahan-id.test.ts`.
  it("never invents a kelurahan id", async () => {
    const { sent } = await book(BOOKED, { sender: { kelurahanId: null }, pkg: { destKelurahanId: null } });
    expect(sent).not.toHaveProperty("kelurahan_id");
    expect(sent.packages[0]).not.toHaveProperty("destination_kelurahan_id");
    const withIds = await book(BOOKED, { sender: { kelurahanId: 31554 }, pkg: { destKelurahanId: 46740 } });
    expect(withIds.sent.kelurahan_id).toBe(31554);
    expect(withIds.sent.packages[0].destination_kelurahan_id).toBe(46740);
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
