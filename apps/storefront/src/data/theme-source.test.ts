import { describe, expect, it } from "vitest";
import {
  needsPlatformFallback,
  platformDefaultThemeStoreId,
  withPlatformFallback,
  type ThemeSlots,
} from "./theme-source";

const HOLDER = "a0000000-0000-4000-8000-000000000001";

// T-9 — the platform default theme is a RENDER-TIME fallback, and it must be OFF unless explicitly
// set. The dangerous failure is not "it doesn't work"; it is "it silently works when nobody asked".
describe("platformDefaultThemeStoreId", () => {
  it("is OFF (null) when no value is set", () => {
    expect(platformDefaultThemeStoreId(undefined)).toBeNull();
  });

  // An empty or whitespace-only var is how this arrives in practice — declared in Coolify and left
  // blank. That must read as OFF, not as "the empty store".
  it.each(["", "   ", "\n"])("treats %j as OFF, not as an empty store id", (v) => {
    expect(platformDefaultThemeStoreId(v)).toBeNull();
  });

  it("trims, so a copy-pasted value with a stray newline still works", () => {
    expect(platformDefaultThemeStoreId(` ${HOLDER}\n`)).toBe(HOLDER);
  });

  // A non-UUID value used to flow straight into the query and 22P02-throw a 500 on EVERY storefront
  // page. A typo'd env must degrade to OFF (own themes only), never take the whole fleet down.
  it.each(["batik-nusantara", "not-a-uuid", "a0000000"])("reads a non-UUID (%j) as OFF", (v) => {
    expect(platformDefaultThemeStoreId(v)).toBeNull();
  });
});

const slots = (over: Partial<ThemeSlots<string>> = {}): ThemeSlots<string> => ({
  homepage: null,
  categoryDefault: null,
  productDefault: null,
  byId: {},
  ...over,
});

// Decision B, both halves of the recorded statement: a store with no theme renders the platform
// default; a store that customised keeps what it customised. Per SLOT — a store with only a homepage
// still gets the platform's category/product tails.
describe("withPlatformFallback", () => {
  const platform = slots({ homepage: "p-home", categoryDefault: "p-cat", productDefault: "p-prod" });

  it("fills every slot for a store with nothing of its own", () => {
    expect(withPlatformFallback(slots(), platform)).toMatchObject({
      homepage: "p-home",
      categoryDefault: "p-cat",
      productDefault: "p-prod",
    });
  });

  it("the store's own slot ALWAYS wins — customisation is kept, never overridden", () => {
    const own = slots({ homepage: "own-home" });
    const merged = withPlatformFallback(own, platform);
    expect(merged.homepage).toBe("own-home");
    // …while the slots the store never built still fall back.
    expect(merged.categoryDefault).toBe("p-cat");
    expect(merged.productDefault).toBe("p-prod");
  });

  it("an empty platform holder changes nothing", () => {
    const own = slots({ homepage: "own-home" });
    expect(withPlatformFallback(own, slots())).toEqual(own);
  });

  it("byId stays the store's OWN — another tenant's rows never enter a merchant's id-space", () => {
    const own = slots({ byId: { a: "own-named" } });
    const merged = withPlatformFallback(own, slots({ byId: { b: "platform-named" } }));
    expect(merged.byId).toEqual({ a: "own-named" });
  });
});

describe("needsPlatformFallback", () => {
  it("false only when all three default slots are the store's own — the holder query is then skipped", () => {
    expect(needsPlatformFallback(slots({ homepage: "h", categoryDefault: "c", productDefault: "p" }))).toBe(false);
    expect(needsPlatformFallback(slots({ homepage: "h", categoryDefault: "c" }))).toBe(true);
    expect(needsPlatformFallback(slots())).toBe(true);
  });
});
