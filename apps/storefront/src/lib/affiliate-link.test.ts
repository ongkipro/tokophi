import { describe, expect, it } from "vitest";
import { affiliateJoinUrl } from "./affiliate-link";

describe("affiliateJoinUrl (ADR 0022)", () => {
  it("points at the affiliate app's /gabung for THIS store", () => {
    expect(affiliateJoinUrl("batik-nusantara", "https://affiliate.tokophi.com", true)).toBe(
      "https://affiliate.tokophi.com/gabung?toko=batik-nusantara",
    );
    expect(affiliateJoinUrl("toko", "https://affiliate.tokophi.com/", true)).toBe("https://affiliate.tokophi.com/gabung?toko=toko");
  });
  it("is null — the programme says applications are not open — when the origin is unset or unusable", () => {
    for (const raw of [undefined, "", "affiliate.tokophi.com", "https://a.b/path", "https://u:p@a.b", "javascript:alert(1)"]) {
      expect(affiliateJoinUrl("toko", raw, true), String(raw)).toBeNull();
    }
  });
  it("accepts plain http only outside a production build", () => {
    expect(affiliateJoinUrl("toko", "http://localhost:4330", true)).toBeNull();
    expect(affiliateJoinUrl("toko", "http://localhost:4330", false)).toBe("http://localhost:4330/gabung?toko=toko");
  });
});
