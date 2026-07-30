import type { Product } from "../data/catalog";

// The purchasable "paket" list for the OrderFunnel = the product's real variant rows. The order API
// matches on the variant TITLE (`option1 / option2`, per packages/db/src/seed.ts), so the string here
// must equal that. A product with no priced variants → one package labelled by the product itself.
// Shared by /promo/<handle> and /lp/<slug> so both price the checkout identically.
export type Pkg = { label: string; variant: string; price: number; compareAt: number; stock: number };

export function buildPackages(product: Product): Pkg[] {
  const variants = (product.variants ?? []).filter((v) => v.price > 0);
  const rows = variants.length
    ? variants
    : [{ option1: null, option2: null, price: product.price, compareAt: product.compareAt ?? null, stock: 1 }];
  return rows.map((v) => {
    const variant = [v.option1, v.option2].filter(Boolean).join(" / ");
    return {
      label: variant || product.name,
      variant, // "" for the default → the order API takes the position-0 variant
      price: v.price,
      // THIS variant's own struck price, not the product-level one. `data/catalog.ts` writes each
      // variant's pre-sale price into `v.compareAt` when a flash sale caps it, so anchoring on
      // `product.compareAt` (the position-0 variant's) showed a "was" and a "Hemat N%" belonging to a
      // different variant on `/promo/<handle>` and `/lp/<slug>`. Falls back to the product level only
      // where a variant carries none — a merchant may set the cut on the product, not per variant.
      compareAt: (() => {
        const was = v.compareAt ?? product.compareAt ?? 0;
        return was > v.price ? was : 0;
      })(),
      stock: v.stock,
    };
  });
}
