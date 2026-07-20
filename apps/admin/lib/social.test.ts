import { describe, it, expect } from "vitest";
import { extractUsername, normalizePublicPhone } from "./social";

// The point of these tests is NOT "does the regex work" — it is the two failure modes that cost a
// merchant a channel silently: (a) a pasted profile URL is rejected or stored whole, (b) a legitimate
// handle is mangled by an over-eager rule. Every "does not touch" case below is a rule we chose not
// to write.

describe("extractUsername — plain input", () => {
  it("keeps a bare username", () => {
    expect(extractUsername("instagram", "tokosaya")).toBe("tokosaya");
  });
  it("strips a leading @ and surrounding whitespace", () => {
    expect(extractUsername("instagram", "  @tokosaya  ")).toBe("tokosaya");
  });
  it("returns null for empty / whitespace — clearing is a valid action", () => {
    expect(extractUsername("instagram", "")).toBeNull();
    expect(extractUsername("instagram", "   ")).toBeNull();
  });
  it("strips invisible zero-width characters that ride along on a copy-paste", () => {
    expect(extractUsername("tiktok", "​tokosaya﻿")).toBe("tokosaya");
  });
});

describe("extractUsername — pasted URLs", () => {
  it("instagram", () => {
    expect(extractUsername("instagram", "https://instagram.com/tokosaya")).toBe("tokosaya");
    expect(extractUsername("instagram", "https://www.instagram.com/tokosaya/?hl=id")).toBe("tokosaya");
    expect(extractUsername("instagram", "instagram.com/tokosaya")).toBe("tokosaya");
  });
  it("tiktok keeps the @-segment, not the video path", () => {
    expect(extractUsername("tiktok", "www.tiktok.com/@tokosaya")).toBe("tokosaya");
    expect(extractUsername("tiktok", "https://www.tiktok.com/@tokosaya/video/7312345678901234567")).toBe("tokosaya");
    expect(extractUsername("tiktok", "https://vt.tiktok.com/@tokosaya?lang=id")).toBe("tokosaya");
  });
  it("facebook — vanity, profile.php?id= and /people/ all yield a linkable value", () => {
    expect(extractUsername("facebook", "https://facebook.com/toko.saya")).toBe("toko.saya");
    expect(extractUsername("facebook", "https://www.facebook.com/profile.php?id=100064123456789")).toBe(
      "100064123456789",
    );
    expect(extractUsername("facebook", "https://www.facebook.com/people/Toko-Saya/100064123456789/")).toBe(
      "100064123456789",
    );
  });
  it("pinterest, including the country subdomain", () => {
    expect(extractUsername("pinterest", "https://id.pinterest.com/tokosaya/")).toBe("tokosaya");
  });
  it("x — and the twitter.com link everyone still has", () => {
    expect(extractUsername("x", "https://x.com/tokosaya")).toBe("tokosaya");
    expect(extractUsername("x", "https://twitter.com/tokosaya?s=20")).toBe("tokosaya");
  });
});

describe("extractUsername — things we deliberately do NOT reject or mangle", () => {
  // Each of these would be broken by an "obvious" universal handle regex.
  it("keeps dots (Facebook) and underscores (TikTok/X)", () => {
    expect(extractUsername("facebook", "toko.saya.official")).toBe("toko.saya.official");
    expect(extractUsername("tiktok", "toko_saya.id")).toBe("toko_saya.id");
    expect(extractUsername("x", "toko_saya_")).toBe("toko_saya_");
  });
  it("does NOT mistake a dotted handle with a trailing slash for a domain", () => {
    // The bug this guards: `/^[\w.-]+\.[a-z]{2,}$/` matches `toko.saya`, so a naive host-strip would
    // delete a real Facebook page and store nothing.
    expect(extractUsername("facebook", "toko.saya/")).toBe("toko.saya");
  });
  it("keeps non-ASCII and mixed case rather than inventing a charset rule", () => {
    expect(extractUsername("instagram", "@TokoSaya")).toBe("TokoSaya");
    expect(extractUsername("instagram", "batik.nusantara96")).toBe("batik.nusantara96");
  });
});

describe("normalizePublicPhone", () => {
  it("canonicalises a mobile the way the rest of the app does", () => {
    expect(normalizePublicPhone("0812-3456-7890")).toBe("6281234567890");
    expect(normalizePublicPhone("+62 812 3456 7890")).toBe("6281234567890");
  });
  it("KEEPS a landline — this field is not WhatsApp", () => {
    // normalizePhone() returns null here (not an 8xx mobile). Refusing it would make a real shop
    // number unpublishable; stores.whatsapp exists separately for exactly this reason.
    expect(normalizePublicPhone("021-5551234")).toBe("021-5551234");
    expect(normalizePublicPhone("(0274) 123456")).toBe("(0274) 123456");
    expect(normalizePublicPhone("1500123")).toBe("1500123");
  });
  it("empty clears the field; only a value with no digits at all is refused", () => {
    expect(normalizePublicPhone("  ")).toBeNull();
    expect(normalizePublicPhone("hubungi kami")).toBe("invalid");
  });
  it("never consults a carrier-prefix list — new prefixes pass", () => {
    for (const p of ["0838", "0881", "0895", "0851"]) {
      expect(normalizePublicPhone(`${p}12345678`)).toMatch(/^62/);
    }
  });
});
