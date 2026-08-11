import { describe, expect, it } from "vitest";
import { cartMessage } from "./cart-message";

// The abandoned-cart WhatsApp message must contain A WAY BACK.
//
// For as long as this feature existed it did not: `signRecoveryToken` had zero callers, so the body
// carried {nama, produk, toko} and nothing tappable. Four docs recorded it as working. These tests
// pin the two halves that keep it working, both of which are silent when broken — a message with no
// link looks completely normal, and so does one carrying a literal `{{link}}`.

const ITEMS = [
  { handle: "dress-batik", name: "Dress Batik", variant: "M", qty: 1, price: 250_000 },
  { handle: "kemeja", name: "Kemeja Oversized", variant: "L", qty: 2, price: 180_000 },
];
const LINK = "https://batiknusantara.tokophi.id/checkout?r=eyJhbGciOiJIUzI1NiJ9.test";

describe("cartMessage", () => {
  // THE seed body, verbatim — no {{link}} in it, which is every store that exists today.
  const SEEDED = "Halo kak {{nama}} 👋, produk *{{produk}}* masih ada di keranjang. Stok terbatas ya kak 😊 — {{toko}}";

  it("appends the link to a template that has no {{link}} — the case that covers every live store", () => {
    const msg = cartMessage(SEEDED, "Rina", ITEMS, "Batik Nusantara", LINK);
    expect(msg).toContain(LINK);
    // The merchant's own copy is untouched and still substituted.
    expect(msg).toContain("Halo kak Rina");
    expect(msg).toContain("Batik Nusantara");
    // Appended, not spliced into the sentence.
    expect(msg.trimEnd().endsWith(LINK)).toBe(true);
  });

  it("substitutes in place when the merchant HAS written {{link}}, and does not also append", () => {
    const positioned = "Halo {{nama}}, lanjut di {{link}} ya — {{toko}}";
    const msg = cartMessage(positioned, "Rina", ITEMS, "Batik Nusantara", LINK);
    expect(msg).toBe(`Halo Rina, lanjut di ${LINK} ya — Batik Nusantara`);
    // Exactly once: appending on top of a substitution would send the URL twice.
    expect(msg.split(LINK)).toHaveLength(2);
  });

  it("never emits a literal {{link}} — the failure mode that reaches a real customer", () => {
    // No link available (an anonymous cart, or a caller that cannot mint one).
    const withToken = cartMessage("Halo {{nama}}, {{link}}", "Rina", ITEMS, "Toko", null);
    expect(withToken).not.toContain("{{link}}");
    // And nothing is appended when there is no link to append.
    expect(cartMessage(SEEDED, "Rina", ITEMS, "Toko", null)).not.toContain("http");
  });

  it("summarises multiple items and survives an empty cart", () => {
    expect(cartMessage("{{produk}}", "R", ITEMS, "T", null)).toBe("Dress Batik +1 lainnya");
    expect(cartMessage("{{produk}}", "R", [], "T", null)).toBe("produk pilihan Anda");
  });

  it("renders a missing name as empty rather than the word undefined", () => {
    expect(cartMessage("Halo {{nama}}!", null, ITEMS, "T", null)).toBe("Halo !");
  });
});
