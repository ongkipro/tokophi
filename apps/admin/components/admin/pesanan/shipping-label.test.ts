import { describe, expect, it } from "vitest";
import { buildLabelHtml, composeSenderLine, formatWeight, type LabelInput } from "./shipping-label";

// N38 — the label's required fields. Four of the five (service type, both kodepos, sender phone,
// item prices) were persisted in the DB and never reached the label: `senderLine`/`weightLabel`
// existed as slots but BOTH callers left them undefined, so "Pengirim" printed the store name and
// nothing else. These tests pin the plumbing: a filled slot must render, and an empty one must
// degrade to exactly the old label, because most dev stores have no pickup address saved.

const base: LabelInput = {
  awb: "DEMOINV1001",
  courier: "spx",
  orderNumber: "#INV-1001",
  storeName: "Batik Nusantara",
  recipient: "Ibu Sari",
  destination: "Jl. Melati 12, Sleman, DI Yogyakarta",
  cod: false,
  totalLabel: "Rp250.000",
  paymentLabel: "QRIS",
  items: [{ qty: 2, title: "Batik Parang", variant: "M" }],
  totalQty: 2,
};

describe("buildLabelHtml — N38 required fields", () => {
  it("prints service name, both kodepos, sender phone, weight and item prices when provided", () => {
    const html = buildLabelHtml({
      ...base,
      serviceName: "SPX Standard",
      senderLine: "Jl. Raya Gubeng No. 42, Gubeng, Surabaya, Jawa Timur",
      senderPhone: "081234567890",
      senderPostcode: "60281",
      destinationPostcode: "55511",
      weightLabel: "1,2 kg",
      items: [{ qty: 2, title: "Batik Parang", variant: "M", priceLabel: "Rp125.000" }],
    });
    expect(html).toContain("SPX Standard");
    expect(html).toContain("60281");
    expect(html).toContain("55511");
    expect(html).toContain("081234567890");
    expect(html).toContain("1,2 kg");
    expect(html).toContain("@Rp125.000");
    expect(html).toContain("Jl. Raya Gubeng No. 42");
  });

  it("renders no empty shells when the optional fields are absent (store with no pickup address)", () => {
    const html = buildLabelHtml(base);
    // No stray separators or the strings "null"/"undefined" leaking into the label.
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("@Rp"); // bare "@" lives in the CSS (@page/@media) legitimately
    expect(html).not.toContain('<div class="pc">');
  });

  it("escapes HTML in the new slots — they carry merchant-typed text", () => {
    const html = buildLabelHtml({ ...base, senderLine: 'Jl. <b>"X"</b> & Co', serviceName: "<svc>" });
    // The template itself uses <b> for the payment label, so assert on the INPUT strings: the
    // merchant-typed markup must come out entity-escaped, never as live tags.
    expect(html).not.toContain('Jl. <b>"X"</b>');
    expect(html).toContain("Jl. &lt;b&gt;&quot;X&quot;&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<svc>");
    expect(html).toContain("&lt;svc&gt;");
  });
});

// Sorting code (KiriminAja, 2026-09-14): required on the label for SPX, ID Express, J&T, J&T Cargo;
// issued in production only. The slot is ALWAYS drawn for those four — filled, or visibly missing.
describe("buildLabelHtml — sorting code", () => {
  it("prints the code for a courier that requires it", () => {
    const html = buildLabelHtml({ ...base, courier: "spx", sortingCode: "JOG-JOG1000-JKT2010" });
    expect(html).toContain('<div class="sortv">JOG-JOG1000-JKT2010</div>');
    expect(html).not.toContain("Belum tersedia");
  });

  it("marks the slot MISSING, never omits it, when a required courier has no code yet", () => {
    for (const courier of ["spx", "idx", "jnt", "jtcargo"]) {
      const html = buildLabelHtml({ ...base, courier, sortingCode: null });
      expect(html, courier).toContain('class="sort missing"');
      expect(html, courier).toContain("Belum tersedia");
    }
  });

  it("draws nothing for a courier that does not require it and has no code", () => {
    const html = buildLabelHtml({ ...base, courier: "jne", sortingCode: null });
    expect(html).not.toContain('class="sort');
  });

  it("escapes the code — it came from a network", () => {
    const html = buildLabelHtml({ ...base, courier: "spx", sortingCode: '<img src=x onerror="1">' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;1&quot;&gt;");
  });

  it("puts the code above the barcode, where a sorter reads it first", () => {
    const html = buildLabelHtml({ ...base, courier: "spx", sortingCode: "JOG-JOG1000-JKT2010" });
    expect(html.indexOf('<div class="sort"')).toBeGreaterThan(0);
    expect(html.indexOf('<div class="sort"')).toBeLessThan(html.indexOf('<div class="bc"'));
  });
});

describe("formatWeight", () => {
  it("formats kg with id-ID decimals and grams below 1 kg", () => {
    expect(formatWeight(1200)).toBe("1,2 kg");
    expect(formatWeight(1000)).toBe("1 kg");
    expect(formatWeight(800)).toBe("800 g");
  });
  it("returns null for nothing to say — a label must not print '0 g'", () => {
    expect(formatWeight(0)).toBeNull();
    expect(formatWeight(null)).toBeNull();
    expect(formatWeight(undefined)).toBeNull();
  });
});

describe("composeSenderLine", () => {
  it("joins address + kecamatan and skips blanks", () => {
    expect(composeSenderLine({ address: "Jl. Raya 1", kecamatanName: "Gubeng, Surabaya, Jawa Timur" })).toBe(
      "Jl. Raya 1, Gubeng, Surabaya, Jawa Timur",
    );
    expect(composeSenderLine({ address: "  ", kecamatanName: "Gubeng" })).toBe("Gubeng");
    expect(composeSenderLine({ address: null, kecamatanName: "" })).toBeNull();
  });
});
