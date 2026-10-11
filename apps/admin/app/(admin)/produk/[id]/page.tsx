import { notFound, redirect } from "next/navigation";
import { getCategoryOptions, getProduct, productNumberById, resolveProductIdByNumber } from "@/lib/data/products";
import { ProductEditor } from "./product-editor";

export const dynamic = "force-dynamic";

// Shopify-style product URL: `/produk/1042`, the merchant-facing catalog number (ADR 0013), not the
// internal UUID. It is the number shown on the product list, searchable in ⌘K, and the one a Merchant
// Center or Events Manager disapproval names — so it is the only id a merchant can actually act on.
// The UUID remains the primary key and every foreign key; only this URL changed.
//
// ⚠️ THE SHAPE TEST IS LOAD-BEARING. `products.number` is `integer` and `products.id` is `uuid`, and
// Postgres refuses the cross-type literal outright (`invalid input syntax for type uuid`, 22P02) —
// which surfaces as a 500 from inside the render, not the `notFound()` this page intends. So the param
// is classified in JS BEFORE any query touches it.
const NUMBER = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: param } = await params;
  // Carried across the redirects below: a bookmark like `?tab=media` should survive being canonicalised,
  // otherwise the redirect quietly drops the merchant back to the default tab.
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") sp.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
  }
  const qs = sp.toString() ? `?${sp}` : "";

  // An old bookmark or a link from before this change. Redirect rather than render both forever —
  // otherwise the UUID URL never dies and the number never becomes the product's identity.
  if (UUID.test(param)) {
    const number = await productNumberById(param);
    if (!number) notFound();
    redirect(`/produk/${number}${qs}`);
  }

  if (!NUMBER.test(param)) notFound();
  // `/produk/007` resolves to 7 but is not the canonical URL — one product, one address.
  const n = Number(param);
  if (String(n) !== param) redirect(`/produk/${n}${qs}`);
  const id = await resolveProductIdByNumber(n);
  if (!id) notFound();

  const [product, categoryOptions] = await Promise.all([getProduct(id), getCategoryOptions()]);
  if (!product) notFound();
  return <ProductEditor product={product} categoryOptions={categoryOptions} />;
}
