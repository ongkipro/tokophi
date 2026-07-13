// ADR 0009 — the page a template is being rendered ON.
//
// The 8 sections were designed for the homepage, where "the page" has no subject. A `category`
// or `product` template renders the SAME sections on a page that DOES have one (the collection
// being browsed / the product being viewed), so sections that merchandise products need to know
// it — e.g. a Grid Produk dropped on a category template with no explicit collection should list
// THAT category, not the whole catalog.
//
// Passed down by SectionRenderer to the sections that can use it (today: ProductGrid). Sections
// that don't take a `ctx` prop simply ignore it, so this stays additive.
import type { Product } from "../../data/catalog";

export type SectionContext =
  | { kind: "homepage" }
  | { kind: "category"; collectionHandle: string; collectionName: string }
  | { kind: "product"; product: Product };

export const HOMEPAGE_CONTEXT: SectionContext = { kind: "homepage" };
