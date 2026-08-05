import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACKED_DIMS, packedDims } from "./product-dims";

// N33: every seeded product declared a 1 cm cube, and `createShipment` sends those three columns to
// the courier when it books. This suite is the half a typecheck cannot give you — that the numbers
// reach EVERY seeded handle, and that a handle nobody has classified fails loudly instead of quietly
// getting a default.
//
// ⚠️ THE HANDLES ARE READ OUT OF THE SEEDERS, not copied here. A list in a test is a list that goes
// stale the first time somebody adds a product, and this repo has already paid that bill twice (a
// two-file mint scanner, a two-file credential scanner). The extraction is checked by its own count:
// if a regex stops matching, the floor below fails with the number it found rather than passing on an
// empty set.

const HERE = new URL(".", import.meta.url);
const read = (f: string) => readFileSync(fileURLToPath(new URL(f, HERE)), "utf8");

/** `["Dress Midi Motif Bunga", "👗", 189_000, "Dress", "dress-midi-bunga"],` → the last string. */
function slugsFromSeed(): string[] {
  const block = read("seed.ts").match(/const PRODUCT_SEED[\s\S]*?\n\];/)?.[0] ?? "";
  return [...block.matchAll(/"([a-z0-9]+(?:-[a-z0-9]+)+)"\s*\]\s*,/g)].map((m) => m[1]);
}

/** `handle: "blazer-formal-wanita-premium-slim-fit",` in the extra-products seeder. */
function handlesFromSeedProducts(): string[] {
  return [...read("seed-products.ts").matchAll(/handle:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

describe("every seeded product ships with a believable parcel size (N33)", () => {
  const handles = [...slugsFromSeed(), ...handlesFromSeedProducts()];

  it("finds the seeded handles at all", () => {
    // The scan's own guard. 14 in `seed.ts` + 10 in `seed-products.ts` = 24 today; a floor of 20
    // survives ordinary editing and still fails if either regex silently stops matching.
    expect(handles.length, `only found ${handles.length} seeded product handles — has the scan broken?`).toBeGreaterThanOrEqual(20);
  });

  it("resolves a parcel size for each one", () => {
    const unresolved = handles.filter((h) => {
      try {
        packedDims(h);
        return false;
      } catch {
        return true;
      }
    });
    expect(unresolved, `no PACKED_DIMS entry for: ${unresolved.join(", ")}`).toEqual([]);
  });

  it("never declares a 1 cm axis — that is the defect, not a small value", () => {
    // The exact shape that shipped: `lengthCm: 1, widthCm: 1, heightCm: 1`. A 1 cm axis is not a
    // conservative estimate, it is a claim to the courier that the parcel is flat.
    for (const [kind, d] of Object.entries(PACKED_DIMS)) {
      for (const [axis, cm] of Object.entries(d)) {
        expect(cm, `${kind}.${axis} = ${cm} cm`).toBeGreaterThan(1);
      }
    }
  });

  it("refuses an unknown handle instead of defaulting", () => {
    // The whole reason a shared table exists. A fallback would put a plausible number nobody chose on
    // a real parcel — which is what 1×1×1 was.
    expect(() => packedDims("sepatu-sneakers-kanvas")).toThrow(/No packed dimensions/);
  });

  it("neither seeder hardcodes dimensions any more", () => {
    // Both files wrote `lengthCm: 1` by hand, and fixing one would have left the other.
    for (const file of ["seed.ts", "seed-products.ts"]) {
      expect(read(file), `${file} still writes a dimension literal`).not.toMatch(/(?:length|width|height)Cm:\s*\d/);
    }
  });
});
