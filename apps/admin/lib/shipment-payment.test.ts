import { describe, it, expect } from "vitest";
import { shipmentPaymentState, shipmentPaymentLabel } from "./shipment-payment";

// One KiriminAja booking carries two money flows in OPPOSITE directions, and the response fields
// that tell them apart were parsed away for both. This suite pins the separation.
//
//   NON-COD  we → KiriminAja. An UNPAID booking never gets a waybill, so the parcel silently does
//            not ship while the order reads "dibooking".
//   COD      buyer → KiriminAja → merchant. The vendor IGNORES `payment_method` for COD packages
//            and rejects the combination with code 4003, so we owe nothing.

describe("shipmentPaymentState — COD and VA are different money", () => {
  it("a COD order is settled whatever the vendor put in payment_status", () => {
    // The docs never say what `payment_status` holds for a COD package. Reading it would put a
    // false "belum dibayar" on parcels nobody owes anything for — so the COD flag decides, alone.
    for (const status of ["unpaid", "pending", "paid", "", null, undefined, "wat"]) {
      const s = shipmentPaymentState({ isCod: true, kaPaymentStatus: status });
      expect(s).toEqual({ flow: "cod", settled: true, blocking: false });
    }
  });

  it("COD never blocks, even carrying a pay URL the vendor should not have sent", () => {
    const s = shipmentPaymentState({ isCod: true, kaPaymentStatus: "unpaid", kaPaymentUrl: "https://x/y" });
    expect(s.blocking).toBe(false);
    expect(s.flow).toBe("cod");
  });

  it("an UNPAID non-COD booking blocks and keeps the pay URL", () => {
    // This is the whole point: the parcel will not ship until this is settled, and before these
    // columns existed nothing on any screen could say so.
    const s = shipmentPaymentState({ isCod: false, kaPaymentStatus: "unpaid", kaPaymentUrl: "https://pay/1" });
    expect(s).toEqual({ flow: "va", settled: false, blocking: true, payUrl: "https://pay/1" });
  });

  it("PENDING is in flight, not a failure", () => {
    // VA/QRIS confirmation is not instant. Shouting at a merchant who paid thirty seconds ago is
    // how a warning becomes wallpaper — and then the one that matters is ignored too.
    const s = shipmentPaymentState({ isCod: false, kaPaymentStatus: "pending", kaPaymentUrl: null });
    expect(s.settled).toBe(false);
    expect(s.blocking).toBe(false);
  });

  it("PAID is settled and carries no call to action", () => {
    const s = shipmentPaymentState({ isCod: false, kaPaymentStatus: "paid" });
    expect(s).toEqual({ flow: "va", settled: true, blocking: false });
  });

  it("is case- and whitespace-insensitive about the vendor's spelling", () => {
    for (const raw of ["UNPAID", " unpaid ", "Unpaid"]) {
      expect(shipmentPaymentState({ isCod: false, kaPaymentStatus: raw }).blocking).toBe(true);
    }
  });

  it("no reading is 'unknown' — never 'unpaid'", () => {
    // Every order booked before 0087 has NULL here. Treating absence as a debt would flag the whole
    // back catalogue; treating an unrecognised status as fine is the same discipline the tracking
    // mapper uses for a code it does not know.
    for (const raw of [null, undefined, "", "   ", "settled-ish"]) {
      const s = shipmentPaymentState({ isCod: false, kaPaymentStatus: raw });
      expect(s.flow).toBe("unknown");
      expect(s.blocking).toBe(false);
    }
  });

  it("only ever blocks on the VA flow", () => {
    const every = [true, false].flatMap((isCod) =>
      ["unpaid", "pending", "paid", null, "??"].map((st) => shipmentPaymentState({ isCod, kaPaymentStatus: st })),
    );
    for (const s of every) if (s.blocking) expect(s.flow).toBe("va");
  });

  it("never names the provider to a merchant (ADR 0004)", () => {
    const every = [true, false].flatMap((isCod) =>
      ["unpaid", "pending", "paid", null].map((st) => shipmentPaymentLabel(shipmentPaymentState({ isCod, kaPaymentStatus: st }))),
    );
    for (const label of every) {
      expect(label.toLowerCase()).not.toContain("kiriminaja");
      expect(label.toLowerCase()).not.toContain("qris");
      expect(label).not.toMatch(/\bva\b/i);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
