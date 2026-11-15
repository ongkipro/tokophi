import { describe, expect, it } from "vitest";
import { normalizeSignupCode, SIGNUP_CODE_RE } from "./signup-code";
import { readFileSync } from "node:fs";

describe("normalizeSignupCode — one canonical form for every door", () => {
  it("empty means no code (the normal signup)", () => {
    expect(normalizeSignupCode("")).toBe("");
    expect(normalizeSignupCode("   ")).toBe("");
    expect(normalizeSignupCode(null)).toBe("");
    expect(normalizeSignupCode(undefined)).toBe("");
  });

  it("trims and upper-cases, so the operator's code and the merchant's typing compare equal", () => {
    expect(normalizeSignupCode("  mitra-sby1 ")).toBe("MITRA-SBY1");
    expect(normalizeSignupCode("ABC")).toBe("ABC");
  });

  it("anything that cannot be a code is null (refused with the unknown-code sentence)", () => {
    for (const bad of ["ab", "-ABC", "AB C", "AB.C", "ABC:1", "x".repeat(33), "kode;drop", "ÄBC"]) expect(normalizeSignupCode(bad)).toBeNull();
    expect(normalizeSignupCode("A".repeat(32))).toBe("A".repeat(32));
  });

  it("the app shape is the migration's CHECK — the two cannot drift", () => {
    const sql = readFileSync(new URL("../../db/drizzle/0117_store_shipping_provider.sql", import.meta.url), "utf8");
    const check = /signup_codes_code_check" check \("code" ~ '([^']+)'\)/.exec(sql)?.[1];
    expect(check).toBe(SIGNUP_CODE_RE.source);
  });
});
