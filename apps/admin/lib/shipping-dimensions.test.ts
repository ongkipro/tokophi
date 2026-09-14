import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// THE QUOTE AND THE BOOKING MUST DESCRIBE THE SAME BOX.
//
// KiriminAja applies VOLUMETRIC weight (w × l × h ÷ 6) whenever it exceeds the actual weight. Their
// pricing doc says so, and it is measurable — one 1.000 g order, Yogyakarta → Mampang Prapatan, SPX
// Reguler, on the live sandbox:
//
//     weight only ....................................... Rp13.700   ← what the shopper was charged
//     weight + 40×30×20 cm .............................. Rp54.800   ← what the booking cost
//     weight 4.000 g (the volumetric those dims imply) ... Rp54.800   ← identical, to the rupiah
//
// `createShipment` has ALWAYS sent dimensions when it books (`packageRows` → max per axis). The
// QUOTE sent weight alone. So the two priced different parcels and the merchant absorbed the
// Rp41.100 difference, on every bulky-light order, with nothing on any screen saying so.
//
// ⚠️ WHY A SOURCE SCAN. The failure is an OMITTED field, and omission is invisible to a unit test of
// either half: `weightForCart` returns a valid object without dimensions, `kaShippingPrice` sends a
// valid request without them, and the API answers 200 with a cheaper price. Only the two halves read
// together show it — and only against a live courier does the number move. So what is pinned is that
// the fields are still THREADED, end to end.
//
// ⚠️ AND THE SOURCE IS READ AS **CODE** (`test/source-code.ts`), NEVER AS TEXT — this file matched raw
// characters until 2026-08-03, which made it the fourth guard in the repo with that hole and by some
// distance the most expensive one. Measured: commenting the three `lengthCm/widthCm/heightCm` lines
// out of `shipping-quote.ts` — the exact "let me disable this while I debug a courier 400" edit —
// left all five tests GREEN while the quote reverted to weight-only pricing. That is the Rp41.100
// bug, restored by three `//` and shipped past its own guard. `codeOnly` is the right half of the
// pair here: an omitted field is a claim about what the file EXECUTES, and a `lengthCm: pkg.lengthCm`
// inside a comment or a string sends nothing to anybody.
//
// Tokens come back space-joined, hence `p\s*\.\s*lengthCm` rather than `p\.lengthCm`.

const admin = (p: string) => codeOnly(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8"));
const lib = (p: string) =>
  codeOnly(readFileSync(fileURLToPath(new URL("../../../packages/lib/src/" + p, import.meta.url)), "utf8"));

/** The three axes, and the KiriminAja request key each one becomes. */
const AXES = [
  ["lengthCm", "length"],
  ["widthCm", "width"],
  ["heightCm", "height"],
] as const;

describe("volumetric dimensions reach the quote", () => {
  it("weightForCart reads them from `products`, not from the variant", () => {
    const src = admin("./shipping-weight.ts");
    // `product_variants` carries ONLY `weight_grams`; reading dimensions off it returns undefined and
    // silently drops the volumetric input — which is how the quote came to disagree with the booking.
    for (const [col] of AXES) {
      expect(src, col).toMatch(new RegExp(String.raw`\w\s*:\s*schema\s*\.\s*products\s*\.\s*${col}\b`));
    }
  });

  it("both entry points return them — the cart AND an existing order", () => {
    // weightForOrder feeds the admin re-quote. If only the cart half carries dimensions, a merchant
    // re-quoting an order gets the old, cheaper, wrong number.
    // `stackedDims` (2026-09-14, replaces the max-per-axis `maxDims`): the SAME rule in both, and in
    // the two booking-side call sites in actions/shipping.ts — the quote, the re-quote and the
    // booking must describe one box, and it is the box the v6.2 validator prices (Σ item volumes).
    const src = admin("./shipping-weight.ts");
    expect(src.match(/\.\.\.\s*stackedDims\s*\(/g) ?? []).toHaveLength(2);
    expect(src).not.toMatch(/maxDims/);
    const booking = admin("./actions/shipping.ts");
    expect(booking.match(/=\s*stackedDims\s*\(/g) ?? []).toHaveLength(2);
  });

  it("the quote forwards them to KiriminAja", () => {
    const src = admin("./shipping-quote.ts");
    for (const [col] of AXES) {
      expect(src, col).toMatch(new RegExp(String.raw`\b${col}\s*:\s*pkg\s*\.\s*${col}\b`));
    }
  });

  it("kaShippingPrice puts them in the request body", () => {
    const src = lib("kiriminaja.ts");
    for (const [col, key] of AXES) {
      expect(src, col).toMatch(
        new RegExp(String.raw`\.\.\.\s*\(\s*p\s*\.\s*${col}\s*\?\s*\{\s*${key}\s*:\s*p\s*\.\s*${col}\s*\}\s*:\s*\{\s*\}\s*\)`),
      );
    }
  });

  it("the rate cache is keyed on them — two box sizes must not share a quote", () => {
    // Without this, the first cart to quote a route fixes the price for every later cart on it,
    // whatever size box they are. A cache key that omits a price input is a wrong price, served fast.
    //
    // ⚠️ Scoped with `[^;]*`, not `[\s\S]*`: `codeOnly` returns the file as ONE line, so an unbounded
    // gap would happily match three mentions of the axes scattered anywhere in the module. `[^;]*`
    // stops at the end of the `const key = …;` statement, which is the claim being made. (The literal
    // `ka:price:` is not asserted — its punctuation is inert inside a template, by design; what has
    // to be there is the INTERPOLATED code, and that survives.)
    const src = lib("kiriminaja.ts");
    expect(src).toMatch(
      /const\s+key\s*=[^;]*lengthCm\s*\?\?\s*0[^;]*widthCm\s*\?\?\s*0[^;]*heightCm\s*\?\?\s*0[^;]*;/,
    );
  });
});
