import { describe, expect, it } from "vitest";
import { autoCatalogFill, feedAgeGroup, feedGender, isApparelPath, suggestGender, suggestGoogleCategory } from "./taxonomy-suggest";

const id = (...t: Array<string | null | undefined>) => suggestGoogleCategory(...t)?.id ?? null;

describe("suggestGoogleCategory", () => {
  it("classifies real non-fashion listings (production titles, 2026-10-12)", () => {
    expect(id("Saratoga - Serum Tanaman Premium untuk Fase Penting")).toBe(113); // was Skin Care
    expect(id("Bensu - Stimulator Pemulihan Tanaman Hortikultura")).toBe(113);
    expect(id("Kojien - Stabilitas Pertumbuhan Tanaman Pangan")).toBe(113);
    expect(id("Aussie Sawit Ganoderma - Recovery Sawit & Anti-Kulat")).toBe(691);
    expect(id("Pupuk pelebat")).toBe(113);
    expect(id("Kefir Collagen Soap 60gr")).toBe(474); // was Vitamins & Supplements
    expect(id("Valoish Daily Fresh Intimate Wash Mango 60 g")).toBe(485);
    expect(id("Botol Putri 100ml Putih Natural Untuk Toner Dan Sabun")).toBe(6919); // the bottle, not toner
    expect(id("Lulur 250gr Hitam / | Pot Krim")).toBe(6919);
    expect(id("Lulur Badan Bengkoang")).toBe(474);
  });

  it("matches whole words only", () => {
    expect(id("Rokok Kretek")).toBeNull(); // "rok" (Skirts)
    expect(id("Brokoli Segar")).toBeNull();
    expect(id("Rok Plisket Premium")).toBe(1581);
    expect(suggestGender("Kaos Motif Zebra")).toBeNull(); // "bra"
  });

  it("keeps the longest keyword within one text", () => {
    expect(id("Celana Pendek Pria")).toBe(207);
    expect(id("Celana Kulot")).toBe(204);
  });

  it("screens the title before the category and description", () => {
    // A description mentions everything; it must never outvote the title.
    expect(id("Saratoga Serum Tanaman", "Fashion", "serum skincare toner")).toBe(113);
    expect(id("Produk Baru", "Dress", "kaos kaki")).toBe(2271);
    expect(id("Produk Baru", "", "pupuk organik cair")).toBe(113);
    expect(id("Produk Baru", "Fashion", "")).toBeNull();
  });
});

describe("feed enum guards", () => {
  it("normalises aliases and drops unknown values", () => {
    expect(feedGender("women")).toBe("female"); // found on live rows, rejected by Google
    expect(feedGender("Male")).toBe("male");
    expect(feedGender("ladies")).toBeNull();
    expect(feedGender("")).toBeNull();
    expect(feedAgeGroup("adult")).toBe("adult");
    expect(feedAgeGroup("dewasa")).toBeNull();
  });
});

describe("autoCatalogFill — the Seller editor fills what the merchant has not set, never what they have", () => {
  const open = { gcat: false, gender: false, age: false };
  const base = { category: "", description: "", currentPath: "" };

  it("apparel title → Google category + gender + adult", () => {
    const p = autoCatalogFill({ ...base, title: "Gamis Syari Katun Wanita", locked: open });
    expect(isApparelPath(p.gcat?.path)).toBe(true);
    expect(p.gender).toBe("female");
    expect(p.ageGroup).toBe("adult");
  });

  it("a non-apparel product gets its category, and NO gender / age (a fertiliser has neither)", () => {
    const p = autoCatalogFill({ ...base, title: "Pupuk Organik Cair 1 Liter", locked: open });
    expect(isApparelPath(p.gcat?.path)).toBe(false);
    expect(p.gender).toBeNull();
    expect(p.ageGroup).toBeNull();
  });

  it("locked fields are left out of the patch entirely — the merchant's value is never touched", () => {
    const p = autoCatalogFill({ ...base, title: "Gamis Wanita", locked: { gcat: true, gender: true, age: true }, currentPath: "Apparel & Accessories > Clothing > Dresses" });
    expect(p).toEqual({});
  });

  it("a locked apparel category still drives the unlocked gender / age", () => {
    const p = autoCatalogFill({ ...base, title: "Kemeja Pria", locked: { gcat: true, gender: false, age: false }, currentPath: "Apparel & Accessories > Clothing > Shirts & Tops" });
    expect(p).not.toHaveProperty("gcat");
    expect(p.gender).toBe("male");
    expect(p.ageGroup).toBe("adult");
  });

  it("no match → null, never a guess", () => {
    const p = autoCatalogFill({ ...base, title: "Xyz 123", locked: open });
    expect(p.gcat).toBeNull();
    expect(p.gender).toBeNull();
  });
});
