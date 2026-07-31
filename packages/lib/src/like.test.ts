import { describe, expect, it } from "vitest";
import { likeContains, likeEscape } from "./like";

// The failure this guards is SILENT: an unescaped pattern returns a full, plausible-looking result
// list instead of an error. Nobody reports "my search returned too much" as a bug — they report the
// wrong parcel being shipped.

describe("likeEscape", () => {
  it("neutralises both wildcards", () => {
    expect(likeEscape("%")).toBe("\\%");
    expect(likeEscape("_")).toBe("\\_");
    expect(likeEscape("SPX_123")).toBe("SPX\\_123");
    expect(likeEscape("50%")).toBe("50\\%");
  });

  it("escapes the backslash FIRST, so an escape cannot be forged", () => {
    // If `\` were handled last, the `\` we add for `%` would itself be doubled and the `%` would go
    // back to being a wildcard. Order matters and a single regex pass is what guarantees it.
    expect(likeEscape("\\")).toBe("\\\\");
    expect(likeEscape("\\%")).toBe("\\\\\\%");
  });

  it("leaves ordinary search terms untouched", () => {
    // Over-escaping is its own bug: it would stop real order numbers and Indonesian names matching.
    for (const s of ["INV-2026-0001", "Nur'aini", "Kec. Gubeng", "SPX123456789", "batik tulis"]) {
      expect(likeEscape(s)).toBe(s);
    }
  });

  it("likeContains wraps, and the wrapping %% stay wildcards", () => {
    expect(likeContains("50%")).toBe("%50\\%%");
    expect(likeContains("")).toBe("%%"); // an empty search still means "everything" — deliberate
  });
});
