import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickKelurahan } from "./kelurahan-pick";
import { codeOnly } from "../../../test/source-code";

// 🔴 THE DESTINATION SUBDISTRICT: A NAME ARRIVES, AN ID IS DERIVED (Task 8.17, destination half).
//
// `v6.2/request_pickup` accepts `destination_kelurahan_id`, and until now nothing produced one: the
// checkout has always posted a kelurahan (it is how the kodepos is filled) and `/api/public/order`
// threw it away. The risk in wiring it up is not "no id" — the booking has always coped with that —
// it is a WRONG id, which this repo has already paid for twice on the sender side.
//
// Three things can go wrong, and there is one claim family for each:
//   1. the conversion itself accepts something it should not          → pickKelurahan
//   2. the order stores a name without its id, or an id from a request → the route's own source
//   3. the booking pairs a stored id with a GUESSED district           → shipping.ts's own source

describe("pickKelurahan", () => {
  const rows = [
    { name: "Bawuran", kaKelurahanId: 31483 },
    { name: "Wonokromo", kaKelurahanId: 31484 },
    { name: "Segoroyoso", kaKelurahanId: null }, // one of the 4 747 we never matched
  ];

  it("resolves a village the shopper picked from our own list", () => {
    expect(pickKelurahan(rows, "Bawuran")).toEqual({ name: "Bawuran", kaKelurahanId: 31483 });
  });

  it("is case- and space-insensitive on both sides", () => {
    expect(pickKelurahan(rows, "  bawuran ")).toEqual({ name: "Bawuran", kaKelurahanId: 31483 });
    expect(pickKelurahan([{ name: "Wih  Nongkal", kaKelurahanId: 7 }], "Wih Nongkal")).toEqual({
      name: "Wih  Nongkal",
      kaKelurahanId: 7,
    });
  });

  // The ordinary outcome, not a failure: the picker is only shown where the district's postcode is
  // ambiguous, so most orders name no village at all. It must cost nothing and refuse nothing.
  it("answers null when no village was named", () => {
    expect(pickKelurahan(rows, "")).toBeNull();
    expect(pickKelurahan(rows, "   ")).toBeNull();
    expect(pickKelurahan(rows, null)).toBeNull();
    expect(pickKelurahan(rows, undefined)).toBeNull();
  });

  // 🔴 EXACT, NEVER FUZZY. The populator's 0.82 bigram floor joins two datasets written by different
  // people; here both sides are the same table. A near-miss means the value did not come from our
  // list, and the numeral-suffix siblings are exactly the pairs the populator itself got wrong:
  // "Cimanggu I" and "Cimanggu II" are different villages with different ids.
  it("refuses a near miss rather than guessing which village was meant", () => {
    const sib = [
      { name: "Cimanggu I", kaKelurahanId: 8252 },
      { name: "Cimanggu II", kaKelurahanId: 8253 },
    ];
    expect(pickKelurahan(sib, "Cimanggu")).toBeNull();
    expect(pickKelurahan(sib, "Cimangu I")).toBeNull();
    expect(pickKelurahan(rows, "Bawuran Kidul")).toBeNull();
    // …and an exact one still resolves to ITS OWN id, not its sibling's.
    expect(pickKelurahan(sib, "Cimanggu II")).toEqual({ name: "Cimanggu II", kaKelurahanId: 8253 });
  });

  // BOTH OR NEITHER. A name stored without an id reads as "the subdistrict is known" on every screen
  // while the booking still omits the field.
  it("refuses a row we never matched to a vendor id", () => {
    expect(pickKelurahan(rows, "Segoroyoso")).toBeNull();
  });
});

// ── Claims about code that no type-checker has an opinion about ───────────────────────────────────
// Each one carries a MUTATION SELF-CHECK: the same predicate is asserted to FIRE on a copy with the
// defect put back, so the claim can never be green merely for failing to match anything.
const ORDER_ROUTE = codeOnly(readFileSync(new URL("../app/api/public/order/route.ts", import.meta.url), "utf8"));
const SHIPPING = codeOnly(readFileSync(new URL("./actions/shipping.ts", import.meta.url), "utf8"));
const ONGKIR = codeOnly(readFileSync(new URL("../app/api/public/ongkir/route.ts", import.meta.url), "utf8"));

describe("the order route derives the id and never reads one", () => {
  it("stores the resolver's pair, not a value from the request", () => {
    expect(ORDER_ROUTE).toMatch(/resolveDestinationKelurahan\s*\(\s*destId\s*,\s*addr\s*\.\s*kelurahan\s*\)/);
    expect(ORDER_ROUTE).toMatch(/shipKelurahanId\s*:\s*kel\s*\?\s*\.\s*kaKelurahanId\s*\?\?\s*null/);
    expect(ORDER_ROUTE).toMatch(/shipKelurahanName\s*:\s*kel\s*\?\s*\.\s*name\s*\?\?\s*null/);
    // the shape that must never appear: an id taken straight off the body
    const idFromBody = /shipKelurahanId\s*:\s*(?:Number\s*\()?\s*addr\s*\./;
    expect(ORDER_ROUTE).not.toMatch(idFromBody);
    expect(codeOnly("shipKelurahanId: Number(addr.kelurahanId),")).toMatch(idFromBody);
  });
});

describe("the booking omits the id when the district was guessed", () => {
  it("pairs the stored id only with the district it was derived against", () => {
    expect(SHIPPING).toMatch(
      /destKelurahanId\s*:\s*destDistrictId\s*===\s*o\s*\.\s*shipDistrictId\s*\?\s*o\s*\.\s*shipKelurahanId\s*:\s*null/,
    );
    // 77 orders carry no `ship_district_id`, so the guess branch is live. Handing it the stored id
    // would send a village that is not in the kecamatan on the same request.
    const unguarded = /destKelurahanId\s*:\s*o\s*\.\s*shipKelurahanId\s*,/;
    expect(SHIPPING).not.toMatch(unguarded);
    expect(codeOnly("destKelurahanId: o.shipKelurahanId,")).toMatch(unguarded);
  });
});

// The shopper's own list must stay id-free. Wiring the destination half is exactly the change that
// invites "just return the id and echo it back", which would hand a client the value the server is
// supposed to decide — and `resolveDestinationKelurahan` would then be re-derivation in name only.
describe("the public kelurahan list publishes no courier id", () => {
  it("serves kelurahanForDistrict, never the WithKaId reader", () => {
    expect(ONGKIR).toMatch(/kelurahan\s*:\s*await\s+kelurahanForDistrict\s*\(/);
    const leaked = /kelurahanWithKaIdForDistrict/;
    expect(ONGKIR).not.toMatch(leaked);
    expect(codeOnly("kelurahan: await kelurahanWithKaIdForDistrict(id)")).toMatch(leaked);
  });
});
