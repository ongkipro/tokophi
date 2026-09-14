import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeOnly } from "../../../test/source-code";

// THE PARCEL'S MANIFEST AND ITS POSTAL CODES — the caller half of Task 8.14.
//
// `packages/lib/src/kiriminaja-v62.test.ts` drives `kaCreateOrder` and pins what leaves for the
// vendor: both zipcodes present, `items` mirroring what it was handed, and NO coordinates. It
// cannot see where those values come from — hand it a synthetic single line and it is perfectly
// green. What is pinned HERE is the other end of the thread: that `createShipment` reads the real
// `order_line_items` and the seller's real postcode, and never invents either.
//
// ⚠️ Source is read as CODE (`test/source-code.ts`), never as text: an omitted or commented-out
// field is a claim about what the file EXECUTES, and three `//` are exactly the edit this class of
// guard exists to catch. Tokens come back space-joined, so the patterns are whitespace-tolerant.
//
// ⚠️ Every claim carries a MUTATION SELF-CHECK — the same predicate asserted to FAIL against a copy
// with the defect put back. A source guard that matches nothing is green forever.

const src = (p: string) => codeOnly(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8"));
const shipping = () => src("./actions/shipping.ts");

/** Assert the pattern holds on the real file AND does not hold on a copy carrying the old defect. */
function pin(re: RegExp, mutate: [from: string, to: string], label: string) {
  const real = shipping();
  expect(real, label).toMatch(re);
  const mutated = codeOnly(readFileSync(fileURLToPath(new URL("./actions/shipping.ts", import.meta.url)), "utf8").replace(mutate[0], mutate[1]));
  expect(mutated, `${label} — the mutation must be caught, or this test proves nothing`).not.toMatch(re);
}

describe("the booking carries the order's real lines and postcodes", () => {
  // The manifest cannot mirror rows the query never read. `getShippingRates` shares `packageRows`
  // and ignores both columns — ONE definition of "what this parcel is made of" (the N30 lesson).
  it("packageRows reads the line title and its UNIT price", () => {
    pin(
      /title\s*:\s*schema\s*\.\s*orderLineItems\s*\.\s*title/,
      ["title: schema.orderLineItems.title,", ""],
      "order_line_items.title",
    );
    pin(
      /unitPrice\s*:\s*schema\s*\.\s*orderLineItems\s*\.\s*priceIdr/,
      // totalIdr is price × qty; sending it as the per-unit `price` would declare a value the spec
      // says is per unit — and the vendor multiplies by qty for a claim.
      ["unitPrice: schema.orderLineItems.priceIdr,", "unitPrice: schema.orderLineItems.totalIdr,"],
      "order_line_items.price_idr as the per-unit price",
    );
  });

  it("items are built from those rows and handed to the booking", () => {
    pin(
      /const\s+items\s*=\s*pkgRows\s*\.\s*map/,
      ["const items = pkgRows.map((row) => ({", "const items = [pkg].map((row: never) => ({"],
      "items come from the line-item rows",
    );
    pin(
      /name\s*:\s*row\s*\.\s*title/,
      ["name: row.title?.trim() || \"Barang\"", "name: `Pesanan ${o.number}`"],
      "each entry is named after its own line, not after the order",
    );
    // The value that reaches `kaCreateOrder`. Without this the array is built and dropped.
    pin(/insuranceAmount\s*:[^;]{0,120}?,\s*items\s*,/, ["        items,\n", ""], "items reach kaCreateOrder");
  });

  it("the seller's postcode is threaded, not left inside the address string", () => {
    pin(
      /senderZipcode\s*=\s*s\s*\.\s*senderPostcode/,
      ["const senderZipcode = s.senderPostcode?.trim()", "const senderZipcode = (null as string | null)"],
      "store_settings.sender_postcode",
    );
    pin(/zipcode\s*:\s*senderZipcode/, ["        zipcode: senderZipcode,\n", ""], "zipcode reaches kaCreateOrder");
  });

  // 82% of KiriminAja's districts have exactly one postcode; for the rest the district decides
  // nothing. Taking the first row would print a wrong postal code on a real parcel — the same rule
  // the checkout's kodepos auto-fill already follows.
  it("a district postcode is only used when the district leaves no doubt", () => {
    pin(
      /codes\s*\.\s*size\s*===\s*1\s*\?/,
      ["return codes.size === 1 ? [...codes][0] : null;", "return [...codes][0] ?? null;"],
      "exactly one postcode, or nothing",
    );
  });

  // Coordinates (0109) come from ONE producer, `resolveAreaCoords` — a kelurahan/district centroid
  // or null — and reach the client through optional chaining, never a `?? 0`: a zero pair is how a
  // courier would be routed to the Gulf of Guinea. The sink guard (`coordFields`) refuses 0,0 too.
  // KiriminAja's UAT review (2026-09-14): `insurance_amount` is the pricing call's `insurance` fee
  // (never the goods value), a `force_insurance` service is insured whether or not the seller asked,
  // and the rate list is quoted WITH insurance so the fee is known for every service.
  it("insurance_amount is the quoted fee, forced when the service forces it — never the goods value", () => {
    const src = shipping();
    expect(src).toMatch(/const\s+insured\s*=\s*!\s*!\s*input\s*\.\s*insurance\s*\|\|\s*selectedRate\s*\.\s*forceInsurance/);
    expect(src).toMatch(/insuranceAmount\s*:\s*insured\s*\?\s*selectedRate\s*\.\s*insurance\s*:\s*0/);
    expect(src).not.toMatch(/insuranceAmount\s*:\s*input\s*\.\s*insurance\s*\?\s*o\s*\./);
    expect(src).toMatch(/insurance\s*:\s*1\s*,?\s*\}\s*\)/); // the seller's quote asks for the fee
  });

  it("the booking's coordinates come only from resolveAreaCoords, never a literal or ?? 0", () => {
    const src = shipping();
    expect(src).toMatch(/latitude\s*:\s*senderCoords\s*\?\.\s*lat/);
    expect(src).toMatch(/longitude\s*:\s*senderCoords\s*\?\.\s*lng/);
    expect(src).toMatch(/destLatitude\s*:\s*destCoords\s*\?\.\s*lat/);
    expect(src).toMatch(/destLongitude\s*:\s*destCoords\s*\?\.\s*lng/);
    expect(src).not.toMatch(/(latitude|longitude)\s*:[^,]*\?\?\s*0/i);
    expect((src.match(/resolveAreaCoords\s*\(/g) ?? []).length).toBe(2);
  });
});
