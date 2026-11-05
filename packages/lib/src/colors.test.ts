import { describe, expect, it } from "vitest";
import { brandShades, DEFAULT_BRAND_COLOR, isDefaultBrandColor, NEUTRAL_BRAND_SHADES } from "./colors";
import { generateTenantThemeVariables } from "./theme";

// The default colour is "no brand", not a brand: derived through the lightness steps it becomes a
// mid-grey primary, which the Store Builder once showed (and a plain "Simpan" then made live).
describe("brandShades — the default colour is the neutral scale, never a derived grey", () => {
  it("default / empty / null → NEUTRAL_BRAND_SHADES (600 is near-black)", () => {
    for (const v of [null, undefined, "", DEFAULT_BRAND_COLOR, DEFAULT_BRAND_COLOR.toUpperCase(), ` ${DEFAULT_BRAND_COLOR} `]) {
      expect(brandShades(v)).toEqual(NEUTRAL_BRAND_SHADES);
      expect(isDefaultBrandColor(v)).toBe(true);
    }
    expect(NEUTRAL_BRAND_SHADES[600]).toBe(DEFAULT_BRAND_COLOR);
  });

  it("a real brand colour still gets its own scale", () => {
    expect(isDefaultBrandColor("#910311")).toBe(false);
    expect(brandShades("#910311")).not.toEqual(NEUTRAL_BRAND_SHADES);
  });

  it("the Store Builder (default passed in) and the live store (null) emit the SAME brand variables", () => {
    const brand = (css: string) => css.split(" ").filter((d) => d.startsWith("--color-brand")).join(" ");
    expect(brand(generateTenantThemeVariables(DEFAULT_BRAND_COLOR, null))).toBe(brand(generateTenantThemeVariables(null, null)));
    expect(generateTenantThemeVariables(DEFAULT_BRAND_COLOR, null)).toContain(`--color-brand-600: ${DEFAULT_BRAND_COLOR};`);
  });
});
