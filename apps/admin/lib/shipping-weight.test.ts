import { describe, expect, it } from "vitest";
import { stackedDims } from "./shipping-weight";

// The box the quote, the re-quote and the booking all describe (2026-09-14). KiriminAja's v6.2
// validator prices Σ items[].(w×l×h×qty) — measured with four sandbox bookings of one 15×15×24 cm
// parcel: manifests whose volumes summed to the box or less booked at the quoted price; two lines
// each carrying the box's dimensions (2× the volume) were refused "Ongkir tidak sesuai". The old
// rule — the largest value per axis, quantity ignored — priced the second case as the first.
describe("stackedDims", () => {
  it("is the product's own box for a single unit", () => {
    expect(stackedDims([{ l: 15, w: 15, h: 24, qty: 1 }])).toEqual({ lengthCm: 15, widthCm: 15, heightCm: 24 });
  });

  it("stacks quantity — two of one box is twice the height, not the same box", () => {
    expect(stackedDims([{ l: 15, w: 15, h: 24, qty: 2 }])).toEqual({ lengthCm: 15, widthCm: 15, heightCm: 48 });
  });

  it("holds the summed volume of different lines on the largest footprint, rounded up", () => {
    // 30×20×10 (6 000) + 2 × 10×10×5 (1 000) = 7 000 cm³ on a 30×20 footprint → 11,67 → 12 cm
    expect(stackedDims([{ l: 30, w: 20, h: 10, qty: 1 }, { l: 10, w: 10, h: 5, qty: 2 }])).toEqual({ lengthCm: 30, widthCm: 20, heightCm: 12 });
  });

  it("never rounds a stack below the manifest it must hold", () => {
    const lines = [{ l: 7, w: 5, h: 3, qty: 3 }, { l: 4, w: 6, h: 2, qty: 1 }];
    const d = stackedDims(lines);
    const manifest = lines.reduce((s, m) => s + m.l * m.w * m.h * m.qty, 0);
    expect(d.lengthCm! * d.widthCm! * d.heightCm!).toBeGreaterThanOrEqual(manifest);
  });

  it("ignores lines with no dimensions, and omits the box when no line has any", () => {
    expect(stackedDims([{ l: null, w: null, h: null, qty: 2 }, { l: 10, w: 10, h: 10, qty: 1 }])).toEqual({ lengthCm: 10, widthCm: 10, heightCm: 10 });
    expect(stackedDims([{ l: null, w: 0, h: undefined, qty: 1 }])).toEqual({});
    expect(stackedDims([])).toEqual({});
  });
});
