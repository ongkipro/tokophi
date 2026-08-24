// PURE product-row mapper for createProduct/updateProduct — its own module because
// actions/products.ts is "use server" (only async exports allowed) and this must stay
// import-testable (products-autocategory.test.ts). Same split as platform-rank.ts.
import { suggestGoogleCategory } from "@tokophi/lib/taxonomy-suggest";
import type { ProductInput } from "@/lib/actions/products";

export const productFields = (i: ProductInput) => {
  // ── AUTO GOOGLE CATEGORY ON PUBLISH (owner request 2026-08-24) ─────────────────────────────────
  // A PUBLISHED listing with no standard category ships a feed item without its category attribute.
  // The taxonomy seed already backfills via the deterministic suggester — but only at seed time, so
  // every merchant-created product stayed empty unless someone opened the picker. The screening now
  // runs at the same point the listing becomes public: on save with status "active" and NO explicit
  // choice. Rules, in order of authority:
  //   · the merchant's explicit pick ALWAYS wins (only an empty field is filled);
  //   · drafts stay untouched — the merchant may still be typing, and the editor already offers the
  //     same suggestion interactively;
  //   · the inputs are the listing's own text (title + merchant category + description), the same
  //     screening the seed uses, so seed-filled and save-filled rows can never disagree in kind.
  const auto =
    i.status === "active" && i.googleCategoryId == null
      ? suggestGoogleCategory(i.name, i.category, i.description)
      : null;
  return {
  title: i.name,
  handle: i.handle,
  description: i.description || null,
  shortDescription: i.shortDescription || null,
  status: i.status,
  category: i.category || null,
  productType: i.productType || null,
  vendor: i.vendor || null,
  seoTitle: i.seoTitle || null,
  seoDesc: i.seoDesc || null,
  googleCategoryId: i.googleCategoryId ?? auto?.id ?? null,
  googleCategoryPath: i.googleCategoryPath || auto?.path || null,
  gender: i.gender || null,
  ageGroup: i.ageGroup || null,
  material: i.material || null,
  lengthCm: i.lengthCm ?? null,
  widthCm: i.widthCm ?? null,
  heightCm: i.heightCm ?? null,
  };
};
