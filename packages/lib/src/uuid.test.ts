import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

// The failure this guards is a 500 where a 404 belongs: Postgres THROWS 22P02 on a non-UUID string
// bound to a `uuid` column. Both directions matter — refusing an id Postgres would accept 404s a
// real row, which is the same bug wearing the other shirt.
describe("isUuid", () => {
  it("accepts what Postgres accepts", () => {
    expect(isUuid("9f0b7e7c-0000-4000-8000-000000000001")).toBe(true);
    // Case-insensitive, like Postgres's uuid input.
    expect(isUuid("9F0B7E7C-0000-4000-8000-000000000001")).toBe(true);
    // Not v4-only: the nil UUID and a non-RFC variant nibble are still valid uuid input.
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("9f0b7e7c-0000-1000-0000-000000000001")).toBe(true);
  });

  it("refuses what Postgres throws on", () => {
    expect(isUuid("1042")).toBe(false); // the catalog NUMBER merchants actually type
    expect(isUuid("9f0b7e7c-0000-4000-8000-00000000000")).toBe(false); // one short
    expect(isUuid("9f0b7e7c-0000-4000-8000-0000000000012")).toBe(false); // one long
    expect(isUuid("9f0b7e7c-0000-4000-8000-00000000000g")).toBe(false); // non-hex
    expect(isUuid("9f0b7e7c00004000800000000000001")).toBe(false); // no dashes
    expect(isUuid(" 9f0b7e7c-0000-4000-8000-000000000001")).toBe(false); // no trimming
    expect(isUuid("")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
