import { describe, expect, it } from "vitest";
import { safeNext } from "./nav";

describe("safeNext — no open redirect after sign-in", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/affiliate/undangan?t=abc")).toBe("/affiliate/undangan?t=abc");
  });
  it("refuses other origins and junk", () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "", null, undefined, "javascript:alert(1)", "/\t/evil.example", "/\n/evil.example", "/\\evil.example"]) expect(safeNext(bad)).toBe("/");
  });
});
