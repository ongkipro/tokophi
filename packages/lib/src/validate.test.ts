import { describe, it, expect } from "vitest";
import {
  normalizePhone, phoneError,
  normalizeEmail, emailError,
  normalizeName, nameError,
  normalizeAddress, addressError,
  normalizePostcode, postcodeError,
  destIdError,
} from "./validate";

// The checkout boundary. `/api/public/order` re-runs exactly these on every field before it writes a
// customer or an order (the form is UX; the API decides). The governing rule is NORMALISE GENEROUSLY,
// REJECT NARROWLY — over-validation is itself a bug, because a rejected real customer leaves silently
// and nobody files the report. So the invalid cases here are things that CANNOT be a real Indonesian
// customer, and the valid cases include the ones a naive rule would wrongly refuse.

describe("normalizePhone — every shape a human types → canonical 62xxx", () => {
  it("accepts 08…, 8…, +62…, 62…, and the doubled 620… all → the same 62 number", () => {
    expect(normalizePhone("08124612804")).toBe("628124612804"); // local trunk
    expect(normalizePhone("8124612804")).toBe("628124612804"); // bare national
    expect(normalizePhone("+62 812-4612-804")).toBe("628124612804"); // international, separators
    expect(normalizePhone("62 812 4612 804")).toBe("628124612804"); // country code + spaces
    expect(normalizePhone("620812 4612 804")).toBe("628124612804"); // 0 and 62 concatenated
  });

  it("validates STRUCTURE, not carrier — an unusual/new prefix must still pass", () => {
    // The whole point of not hard-coding 811/812/… : a real customer on a brand-new prefix must not
    // be refused. 898xxxxxxx is a structurally valid mobile (starts 8, national length in range).
    expect(normalizePhone("0898765432")).toBe("62898765432");
  });

  it("rejects only what cannot be an Indonesian mobile", () => {
    expect(normalizePhone("0217654321")).toBeNull(); // landline (national starts 2, not 8)
    expect(normalizePhone("0812345")).toBeNull(); // national 6 digits — too short (<9)
    expect(normalizePhone("081246128049999")).toBeNull(); // national 13 digits — too long (>12)
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone({} as unknown)).toBeNull();
  });

  it("phoneError: required, and mirrors normalize", () => {
    expect(phoneError("")).toMatch(/wajib diisi/i);
    expect(phoneError("   ")).toMatch(/wajib diisi/i);
    expect(phoneError("0217654321")).toMatch(/tidak valid/i);
    expect(phoneError("08124612804")).toBeNull();
  });
});

describe("normalizeEmail / emailError — optional, shape only, NO domain whitelist", () => {
  it("empty is VALID (email is optional at checkout)", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(emailError("")).toBeNull();
    expect(emailError("   ")).toBeNull();
  });

  it("lowercases and accepts corporate / university / country-code domains", () => {
    expect(normalizeEmail("Nama@Email.com")).toBe("nama@email.com");
    expect(emailError("ceo@perusahaan.co.id")).toBeNull(); // corporate — must NOT be blocked
    expect(emailError("mahasiswa@ui.ac.id")).toBeNull(); // university
  });

  it("refuses only the structurally broken", () => {
    expect(emailError("notanemail")).toMatch(/tidak valid/i);
    expect(emailError("a@b")).toMatch(/tidak valid/i); // no dot in domain
    expect(emailError("a@b@c.com")).toMatch(/tidak valid/i);
  });
});

describe("normalizeName / nameError — Indonesian names pass; digits/symbols refused", () => {
  it("accepts apostrophes, dots, hyphens, and many spaces", () => {
    expect(nameError("Nur'aini")).toBeNull();
    expect(nameError("M. Rizky")).toBeNull();
    expect(nameError("Siti Aisyah binti Abdullah")).toBeNull();
    expect(normalizeName("  Budi   Santoso ")).toBe("Budi Santoso"); // collapses whitespace
  });

  it("refuses digits, junk, empty, and over-length", () => {
    expect(nameError("")).toMatch(/wajib diisi/i);
    expect(nameError("A")).toMatch(/pendek/i);
    expect(nameError("Budi123")).toMatch(/angka/i);
    expect(nameError("<script>")).not.toBeNull();
    expect(nameError("x".repeat(81))).toMatch(/panjang/i);
  });
});

describe("normalizeAddress / addressError — letters AND digits; junk refused", () => {
  it("accepts a real address and joins multi-line into one", () => {
    expect(addressError("Jl. Melati No. 12, RT 03/RW 05, Blok A-2")).toBeNull();
    expect(normalizeAddress("Jl. Melati No. 12\nRT 03/RW 05")).toBe("Jl. Melati No. 12, RT 03/RW 05");
  });

  it("refuses too-short, single-repeated-char, emoji/control, and digit-only", () => {
    expect(addressError("Jl. A")).toMatch(/pendek/i); // < 10 chars
    expect(addressError("----------")).not.toBeNull(); // <4 distinct chars
    expect(addressError("Jl. Melati 12 \u{1F600}")).toMatch(/tidak didukung/i); // emoji
    expect(addressError("081246128049")).not.toBeNull(); // a pasted phone number, no letters
  });
});

describe("normalizePostcode / postcodeError — optional, exactly 5 digits", () => {
  it("optional (empty ok), strips non-digits, refuses non-5-digit", () => {
    expect(postcodeError("")).toBeNull();
    expect(postcodeError("55281")).toBeNull();
    expect(normalizePostcode("55281-extra")).toBe("55281");
    expect(postcodeError("123")).toMatch(/5 angka/i);
  });
});

describe("destIdError — kecamatan is picked, so the only rule is a positive id", () => {
  it("a positive number resolves; junk / non-positive does not", () => {
    expect(destIdError(1234)).toBeNull();
    expect(destIdError("1234")).toBeNull();
    expect(destIdError(0)).not.toBeNull();
    expect(destIdError(-1)).not.toBeNull();
    expect(destIdError("abc")).not.toBeNull();
  });
});
