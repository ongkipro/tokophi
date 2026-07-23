// Google Merchant / Meta / TikTok product feed (ADR 0011 Phase 3). RSS 2.0 with the `g:` namespace,
// one <item> per VARIANT with g:item_group_id linking a product's colour/size combos — the correct
// apparel feed shape. Per-tenant: the store is resolved from the Host header (like every storefront
// route). Attributes come from the product where set, with safe read-time fallbacks (gender from the
// title, age_group="adult", condition="new") so the feed is never blocked by a blank field.
import type { APIRoute } from "astro";
import { getStoreByHost } from "../../data/store";
import { getCatalog, type Product } from "../../data/catalog";
import { suggestGender } from "@tokophi/lib/taxonomy-suggest";

const xml = (s: string | number | null | undefined) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const absImg = (url: string, origin: string) => (url.startsWith("http") ? url : origin + url);

function items(p: Product, origin: string, brand: string): string {
  const link = `${origin}/produk/${p.handle}`;
  const image = p.image ? absImg(p.image, origin) : "";
  const gender = p.gender || suggestGender(p.name) || "";
  const ageGroup = p.ageGroup || "adult";
  const gpc = p.googleCategoryPath || "";
  // Which option is colour vs size (Warna/Ukuran), so g:color/g:size map correctly regardless of order.
  const opts = p.options ?? [];
  const colorIdx = opts.findIndex((o) => /warna|color|colour/i.test(o.name));
  const sizeIdx = opts.findIndex((o) => /ukuran|size/i.test(o.name));
  const pick = (v: { option1: string | null; option2: string | null }, idx: number) =>
    idx === 0 ? v.option1 : idx === 1 ? v.option2 : null;

  const variants = p.variants && p.variants.length ? p.variants : [{ option1: null, option2: null, price: p.price, stock: 1 }];
  const hasGroup = variants.length > 1;

  return variants
    .map((v, i) => {
      const id = hasGroup ? `${p.handle}-${i + 1}` : p.handle;
      const color = pick(v, colorIdx);
      const size = pick(v, sizeIdx);
      const availability = v.stock > 0 ? "in_stock" : "out_of_stock";
      const lines = [
        `<g:id>${xml(id)}</g:id>`,
        hasGroup ? `<g:item_group_id>${xml(p.handle)}</g:item_group_id>` : "",
        `<g:title>${xml(p.name)}${color || size ? " - " + [color, size].filter(Boolean).join(" ") : ""}</g:title>`,
        `<g:description>${xml(p.description || p.name)}</g:description>`,
        `<g:link>${xml(link)}</g:link>`,
        image ? `<g:image_link>${xml(image)}</g:image_link>` : "",
        `<g:availability>${availability}</g:availability>`,
        `<g:price>${v.price} IDR</g:price>`,
        `<g:brand>${xml(brand)}</g:brand>`,
        `<g:condition>new</g:condition>`,
        gpc ? `<g:google_product_category>${xml(gpc)}</g:google_product_category>` : "",
        gender ? `<g:gender>${xml(gender)}</g:gender>` : "",
        `<g:age_group>${xml(ageGroup)}</g:age_group>`,
        color ? `<g:color>${xml(color)}</g:color>` : "",
        size ? `<g:size>${xml(size)}</g:size>` : "",
        p.material ? `<g:material>${xml(p.material)}</g:material>` : "",
      ].filter(Boolean);
      return `<item>${lines.join("")}</item>`;
    })
    .join("");
}

export const GET: APIRoute = async ({ request }) => {
  const host = request.headers.get("host");
  const store = await getStoreByHost(host);
  if (!store) return new Response("Store not found", { status: 404 });
  const origin = `https://${host}`;
  const catalog = await getCatalog(store);

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">` +
    `<channel>` +
    `<title>${xml(store.name)}</title>` +
    `<link>${xml(origin)}</link>` +
    `<description>${xml(`Katalog produk ${store.name}`)}</description>` +
    catalog.products.map((p) => items(p, origin, store.name)).join("") +
    `</channel></rss>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Cache at the edge for an hour — feeds are polled, not real-time.
      "Cache-Control": "public, max-age=3600",
    },
  });
};
