"use server";
// Data for the Store Builder's image/link pickers — thin server actions the (client) Puck fields can
// call. Reads only; every source is already tenant-scoped (getProducts/getCollections run inside
// withCurrentTenant, getMedia filters by the session store), so there is nothing here to leak.
import { getProducts } from "@/lib/data/products";
import { getCollections } from "@/lib/data/collections";
import { getPages } from "@/lib/data/pages";

export type PickerImage = { id: string; name: string; url: string; sub?: string };
export type PickerLink = { id: string; name: string; href: string; sub?: string };

/** Products that HAVE a usable photo — the image picker offers each product's primary image. */
export async function pickerProducts(): Promise<PickerImage[]> {
  const products = await getProducts();
  return products
    .filter((p) => p.image && !p.image.startsWith("/products/")) // real uploads only; the /products/* fallbacks are demo art
    .map((p) => ({ id: p.id, name: p.name, url: p.image, sub: p.category || undefined }));
}

/** One representative image per category (its first product's photo) — mirrors how category-nav thumbnails
 *  are chosen, so picking a category here yields the same image the storefront would. */
export async function pickerCategoryImages(): Promise<PickerImage[]> {
  const products = await getProducts();
  const seen = new Map<string, PickerImage>();
  for (const p of products) {
    if (p.category && p.image && !seen.has(p.category)) {
      seen.set(p.category, { id: p.category, name: p.category, url: p.image, sub: "Kategori" });
    }
  }
  return [...seen.values()];
}

/** Products as LINK targets (P2 link picker) — the storefront path is /produk/<handle>. */
export async function pickerProductLinks(): Promise<PickerLink[]> {
  const products = await getProducts();
  return products.map((p) => ({ id: p.id, name: p.name, href: `/produk/${p.handle}`, sub: p.category || undefined }));
}

/** Categories as LINK targets — /kategori/<handle>. */
export async function pickerCategoryLinks(): Promise<PickerLink[]> {
  const collections = await getCollections();
  return collections
    .filter((c) => c.published)
    .map((c) => ({ id: c.id, name: c.name, href: `/kategori/${c.handle}`, sub: `${c.products} produk` }));
}

/** Published CMS pages as LINK targets — /halaman/<handle>. */
export async function pickerPageLinks(): Promise<PickerLink[]> {
  const pages = await getPages();
  return pages
    .filter((p) => p.published)
    .map((p) => ({ id: p.id, name: p.title, href: `/halaman/${p.handle}`, sub: "Halaman" }));
}
