import { describe, expect, it, vi } from "vitest";

// productFields is the ONE mapper both createProduct and updateProduct feed — testing it tests the
// auto-category contract for both paths. The module is "use server" + pulls @tokophi/db and
// next/cache at module scope, so next/cache is mocked exactly like users.test.ts does.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { productFields } from "@/lib/product-fields";

const BASE = {
  name: "Blazer Formal Wanita Premium",
  handle: "blazer-formal",
  price: 219000,
  stock: 5,
  status: "draft" as "active" | "draft",
  category: "Outerwear",
  description: "Blazer kerja bahan premium.",
};

describe("auto Google category on publish (owner request 2026-08-24)", () => {
  it("a PUBLISHED listing with no category gets the deterministic suggestion", () => {
    const f = productFields({ ...BASE, status: "active" } as never);
    // "blazer" is a keyword of Coats & Jackets (id 5598) in @tokophi/lib/taxonomy-suggest.
    expect(f.googleCategoryId).toBe(5598);
    expect(f.googleCategoryPath).toContain("Coats & Jackets");
  });

  it("a DRAFT stays untouched — the merchant may still be typing", () => {
    const f = productFields({ ...BASE, status: "draft" } as never);
    expect(f.googleCategoryId).toBeNull();
    expect(f.googleCategoryPath).toBeNull();
  });

  it("the merchant's explicit pick ALWAYS wins over the screening", () => {
    const f = productFields({ ...BASE, status: "active", googleCategoryId: 177, googleCategoryPath: "Apparel & Accessories > Clothing Accessories > Scarves & Shawls" } as never);
    expect(f.googleCategoryId).toBe(177);
    expect(f.googleCategoryPath).toContain("Scarves");
  });

  it("no keyword match on a published listing stays honestly empty — never a guess", () => {
    const f = productFields({ ...BASE, status: "active", name: "Voucher Fisik Spesial", category: "Lainnya", description: "Kartu ucapan." } as never);
    expect(f.googleCategoryId).toBeNull();
  });

  it("the DESCRIPTION is part of the screening, not just the title", () => {
    const f = productFields({ ...BASE, status: "active", name: "Set Santai Wanita", category: "", description: "Piyama satin lembut untuk tidur." } as never);
    expect(f.googleCategoryPath).toContain("Pajamas");
  });
});
