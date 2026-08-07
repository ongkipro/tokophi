import { describe, expect, it } from "vitest";
import { themeSourceStoreId } from "./theme-source";

// T-9 — the platform default theme is a RENDER-TIME override, and it must be OFF unless explicitly set.
// The dangerous failure is not "it doesn't work"; it is "it silently works when nobody asked", which
// would serve one store's theme to all 7 the moment a stray env var appears.
describe("themeSourceStoreId", () => {
  it("returns the store's own id when no override is set", () => {
    expect(themeSourceStoreId("store-a", undefined)).toBe("store-a");
  });

  // An empty or whitespace-only var is how this arrives in practice — declared in Coolify and left
  // blank. That must read as OFF, not as "the empty store".
  it.each(["", "   ", "\n"])("treats %j as OFF, not as an empty store id", (v) => {
    expect(themeSourceStoreId("store-a", v)).toBe("store-a");
  });

  it("serves the platform default to every store once set", () => {
    expect(themeSourceStoreId("store-a", "demo-id")).toBe("demo-id");
    expect(themeSourceStoreId("store-b", "demo-id")).toBe("demo-id");
  });

  it("trims, so a copy-pasted value with a stray newline still works", () => {
    expect(themeSourceStoreId("store-a", " demo-id\n")).toBe("demo-id");
  });
});
