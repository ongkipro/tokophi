import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

const admin = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const lib = (p: string) => readFileSync(fileURLToPath(new URL("../../../packages/lib/src/" + p, import.meta.url)), "utf8");

describe("volumetric dimensions reach the quote", () => {
  it("weightForCart reads them from `products`, not from the variant", () => {
    const src = admin("./shipping-weight.ts");
    // `product_variants` carries ONLY `weight_grams`; reading dimensions off it returns undefined and
    // silently drops the volumetric input — which is how the quote came to disagree with the booking.
    expect(src).toMatch(/l:\s*schema\.products\.lengthCm/);
    expect(src).toMatch(/w:\s*schema\.products\.widthCm/);
    expect(src).toMatch(/h:\s*schema\.products\.heightCm/);
  });

  it("both entry points return them — the cart AND an existing order", () => {
    // weightForOrder feeds the admin re-quote. If only the cart half carries dimensions, a merchant
    // re-quoting an order gets the old, cheaper, wrong number.
    const src = admin("./shipping-weight.ts");
    expect(src.match(/\.\.\.maxDims\(/g) ?? []).toHaveLength(2);
  });

  it("the quote forwards them to KiriminAja", () => {
    const src = admin("./shipping-quote.ts");
    expect(src).toMatch(/lengthCm:\s*pkg\.lengthCm/);
    expect(src).toMatch(/widthCm:\s*pkg\.widthCm/);
    expect(src).toMatch(/heightCm:\s*pkg\.heightCm/);
  });

  it("kaShippingPrice puts them in the request body", () => {
    const src = lib("kiriminaja.ts");
    expect(src).toMatch(/\.\.\.\(p\.lengthCm \? \{ length: p\.lengthCm \} : \{\}\)/);
    expect(src).toMatch(/\.\.\.\(p\.widthCm \? \{ width: p\.widthCm \} : \{\}\)/);
    expect(src).toMatch(/\.\.\.\(p\.heightCm \? \{ height: p\.heightCm \} : \{\}\)/);
  });

  it("the rate cache is keyed on them — two box sizes must not share a quote", () => {
    // Without this, the first cart to quote a route fixes the price for every later cart on it,
    // whatever size box they are. A cache key that omits a price input is a wrong price, served fast.
    const src = lib("kiriminaja.ts");
    // `[\s\S]` rather than the `s` flag — the admin's tsconfig target predates it (TS1501).
    expect(src).toMatch(/ka:price:[\s\S]*lengthCm \?\? 0[\s\S]*widthCm \?\? 0[\s\S]*heightCm \?\? 0/);
  });
});
