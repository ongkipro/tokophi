// ONE product-feed builder, two endpoints (ADR 0011 + ADR 0013).
//
// Google Merchant Center, Meta Commerce and TikTok Catalog Manager all ingest an RSS 2.0 document with
// Google's `g:` namespace, and they agree on nearly every field NAME. They do not agree on values, and
// TikTok disagrees on enough of them (`sku_id` instead of `id`, a 3-level category cap) to need its own
// endpoint. Two hand-maintained feed files is how the two of them silently drift — the same failure
// this repo already fixed once for `retailerId` — so the difference lives in a PROFILE, not a fork.
// TYPE-only import: `data/catalog` pulls in @tokophi/db at module scope, and this builder must stay a
// pure function of its inputs so it can be exercised without a database.
import type { Product } from "../data/catalog";
import { retailerId, itemGroupId, type CatalogIdScheme } from "@tokophi/lib/tracking-ids";
import { feedAgeGroup, feedGender } from "@tokophi/lib/taxonomy-suggest";

export type FeedProfile = {
  /**
   * Every attribute in this document lives in Google's `g:` namespace — an un-namespaced `<id>` is
   * simply ignored by Merchant Center. TikTok's documented required identifier is `sku_id`, so its
   * profile emits BOTH: TikTok publishes no RSS field-mapping table, so whether its parser aliases
   * `id` → `sku_id` is unverified, and emitting the pair costs nothing (Google and Meta ignore
   * attributes they do not recognise).
   */
  idFields: string[];
  /** TikTok: "Only supports three levels" of google_product_category. Google wants the leaf. */
  maxCategoryLevels: number | null;
  /**
   * Google's RSS form is a REPEATED `additional_image_link` element, one per image. TikTok documents a
   * SINGLE field holding a comma-separated list (commas inside a URL encoded as `%2C`) — send it Google's
   * way and TikTok reads at most the first image, or none.
   */
  imagesAsCsv: boolean;
};

export const PROFILES: Record<"google" | "tiktok", FeedProfile> = {
  // Google + Meta share this one. Meta documents the same RSS/`g:` format and the same field names.
  google: { idFields: ["g:id"], maxCategoryLevels: null, imagesAsCsv: false },
  tiktok: { idFields: ["g:id", "g:sku_id"], maxCategoryLevels: 3, imagesAsCsv: true },
};

/**
 * XML-escape AND strip what is illegal in XML 1.0.
 *
 * ⚠️ The strip is the load-bearing half. Escaping alone let a raw control character through — and a
 * single one anywhere makes the WHOLE document unparseable, so one product description pasted out of
 * Word or WhatsApp takes the entire catalog offline. That is the largest blast radius in this file.
 *
 * The set is XML 1.0's `Char` production, complemented: C0 minus tab/LF/CR, DEL, lone surrogates, and
 * the two non-characters U+FFFE/U+FFFF (U+FFFE is a byte-swapped BOM — the classic bad paste). Swept
 * over all 65.536 BMP code points plus astral samples and parsed with a real parser: these are the
 * only survivors that break the document. U+FDD0–FDEF are non-characters too but ARE legal `Char`s,
 * so they stay.
 */
export const xml = (s: string | number | null | undefined) =>
  String(s ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "") // lone surrogates
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Merchant descriptions may contain HTML; Meta documents the field as plain text. */
const plain = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clamp = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

const abs = (url: string, origin: string) => (url.startsWith("http") ? url : origin + url);

/** Repeated elements for Google/Meta, one comma-separated field for TikTok — see `imagesAsCsv`. */
function extraImages(urls: string[], profile: FeedProfile): string[] {
  if (!urls.length) return [];
  if (!profile.imagesAsCsv) return urls.map((u) => `<g:additional_image_link>${xml(u)}</g:additional_image_link>`);
  // A comma inside a URL would split the list, so it is percent-encoded — TikTok documents `%2C`.
  return [`<g:additional_image_link>${xml(urls.map((u) => u.replace(/,/g, "%2C")).join(","))}</g:additional_image_link>`];
}

/**
 * The EXTRA images, beyond the primary one.
 *
 * Only the seeded demo products have a gallery, and it is a naming convention (`-2.webp` … `-5.webp`)
 * rather than data — so it is derived only for those paths. A merchant-uploaded image has no siblings,
 * and inventing URLs for it would publish 404s, which is a disapproval at every provider. Mirrors
 * `productImages()` in data/catalog.ts, minus that module's database import.
 */
const gallery = (p: Product): string[] =>
  p.image && p.image.includes("/products/")
    ? [2, 3, 4, 5].map((n) => p.image.replace(/\.webp$/, `-${n}.webp`))
    : [];

/** Providers document `in stock` / `out of stock` WITH a space; Google's own RSS example uses it too. */
const availability = (stock: number) => (stock > 0 ? "in stock" : "out of stock");

/** `sale_price_effective_date` wants an ISO interval. The sale is live now; it ends when the flash does. */
/**
 * `sale_price_effective_date` — `YYYY-MM-DDThh:mmZ/YYYY-MM-DDThh:mmZ`, exactly.
 *
 * ⚠️ Minutes, no seconds, no milliseconds. `toISOString()` emits both, which is a shape neither
 * Google's syntax line nor Meta's documents. A provider that drops the attribute as malformed applies
 * the sale price with NO END DATE — so after the flash lapses the feed keeps advertising the sale price
 * while `/api/public/order` charges the base price. Under-quoting is exactly what this attribute was
 * added to prevent.
 */
const minuteZ = (d: Date) => `${d.toISOString().slice(0, 16)}Z`;
const saleWindow = (endsAt: string) => `${minuteZ(new Date())}/${minuteZ(new Date(endsAt))}`;

/**
 * A GTIN is 8/12/13/14 digits with a mod-10 check digit. Anything else is a merchant's internal code
 * and must NOT travel as `gtin` — it is rejected as invalid, and its presence hides the
 * `identifier_exists: no` declaration that would otherwise settle the warning.
 */
function validGtin(barcode: string | null): string {
  const d = (barcode ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(d.length)) return "";
  const digits = d.split("").map(Number);
  const check = digits.pop()!;
  // Weights alternate 3,1 from the RIGHTMOST body digit, whatever the length.
  const sum = digits.reverse().reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? d : "";
}

export type FeedItemInput = {
  product: Product;
  origin: string;
  storeName: string;
  scheme: CatalogIdScheme;
  profile: FeedProfile;
};

/**
 * One `<item>` per VARIANT, grouped by `item_group_id` — the correct apparel shape for all three
 * providers (none of them has a separate parent record; the group is implicit).
 *
 * Returns `[]` for a product that cannot form a valid item — today that means no image. `image_link` is
 * REQUIRED by all three, so emitting the item anyway just buys the merchant a disapproval they cannot
 * act on from inside the feed. The Katalog Iklan card counts what is actually publishable.
 */
export function feedItems({ product: p, origin, storeName, scheme, profile }: FeedItemInput): string[] {
  const image = p.image ? abs(p.image, origin) : "";
  if (!image) return [];

  const link = `${origin}/produk/${p.handle}`;
  // The merchant's own brand when they set one; the shop name is the fallback, not the definition.
  const brand = clamp(p.vendor?.trim() || storeName, 70);
  // Enum-guarded: a stray "women" in the row is normalised, anything unknown is omitted (not rejected).
  const gender = feedGender(p.gender) ?? "";
  // ⚠️ NOT `|| "adult"`. `age_group` is factual to all three platforms, and blank is the DEFAULT state
  // (createProduct writes null when the merchant leaves it empty) — so defaulting it published every SKU
  // of a children's-wear shop as adult apparel: mis-targeted delivery and a mismatched-attribute
  // disapproval risk, invented by us. `gender` on the line above already does the right thing: emit it
  // when it is known, omit it when it is not.
  const ageGroup = feedAgeGroup(p.ageGroup) ?? "";
  const category = (() => {
    const path = p.googleCategoryPath || "";
    if (!path || profile.maxCategoryLevels === null) return path;
    return path.split(" > ").slice(0, profile.maxCategoryLevels).join(" > ");
  })();

  // Which option is colour vs size, so g:color/g:size map correctly regardless of option order.
  const opts = p.options ?? [];
  const colorIdx = opts.findIndex((o) => /warna|color|colour/i.test(o.name));
  const sizeIdx = opts.findIndex((o) => /ukuran|size/i.test(o.name));
  const pick = (v: { option1: string | null; option2: string | null; option3: string | null }, idx: number) =>
    idx === 0 ? v.option1 : idx === 1 ? v.option2 : idx === 2 ? v.option3 : null;

  const variants =
    p.variants && p.variants.length
      ? p.variants
      : // A product with no variant rows still needs one item. `seq: 1` matches what the DB default
        // gives a freshly created product's only variant.
        [{ option1: null, option2: null, option3: null, price: p.price, compareAt: p.compareAt ?? null, stock: 1, seq: 1, sku: null, barcode: null }];
  const group = itemGroupId(scheme, p, variants.length);

  // ⚠️ PRICE IS THE FIELD GOOGLE DISAPPROVES ITEMS OVER, and a flash sale is where it goes wrong.
  //
  // The rule is not "apply the discount": it is **be the number `/api/public/order` will charge**, which
  // is `min(variant.price, flashPrice)` — an absolute CAP, evaluated per variant (order/route.ts:296).
  //
  // A ratio derived from `p.price / p.compareAt` looks equivalent and is not: both come from the
  // POSITION-0 variant, so on a catalog where variants differ in price it under-charges the cheap ones
  // and over-charges the dear ones. Measured on a Rp80k sale with a Rp100k default variant: the feed
  // would advertise Rp48.000 for a variant the checkout sells at Rp60.000. That is a disapproval, and
  // in Indonesia advertising a price you will not honour is not merely a data-quality problem.
  const flashPrice = p.flashPrice ?? null;

  return variants.flatMap((v, i) => {
    // "Hubungi untuk harga" — the PDP refuses to sell it and shows no buy button, so publishing it at
    // `0 IDR` would advertise something no shopper can buy and every provider rejects.
    if (v.price <= 0) return [];
    const id = retailerId(scheme, p, { seq: v.seq, index: i, count: variants.length });
    const color = pick(v, colorIdx);
    const size = pick(v, sizeIdx);
    // What the shopper actually pays for THIS variant — the same expression the order endpoint uses —
    // and the price it is discounted from.
    const effective = flashPrice !== null ? Math.min(v.price, flashPrice) : v.price;
    const listPrice = Math.max(v.compareAt ?? 0, v.price);
    const salePrice = effective < listPrice ? effective : null;
    // Google/Meta expect an identifier; `identifier_exists: no` is the documented escape hatch for a
    // merchant who genuinely has neither a GTIN nor an MPN, and it stops the warning being permanent.
    // ONE title for both elements. They used to differ (the bare one without the variant suffix), and
    // Google's RSS profile designates the bare `<title>` as the one it reads — so the colour/size
    // differentiation this code builds would have been thrown away for every variant.
    const title = clamp(p.name + (color || size ? " - " + [color, size].filter(Boolean).join(" ") : ""), 150);
    // GTIN only when it IS one. Google accepts 8/12/13/14 digits with a valid check digit; a merchant's
    // internal barcode ("SKU-123" → "123") would be rejected as an invalid value AND would suppress the
    // `identifier_exists: no` escape hatch below, making the warning permanent.
    const gtin = validGtin(v.barcode);
    const mpn = v.sku ?? "";

    const lines = [
      ...profile.idFields.map((f) => `<${f}>${xml(id)}</${f}>`),
      group ? `<g:item_group_id>${xml(group)}</g:item_group_id>` : "",
      // Bare RSS elements alongside the g: ones. Google explicitly ignores duplicates, and it removes
      // the risk that a provider's parser wants the plain form (neither Meta nor TikTok publishes an
      // item-level RSS mapping, so this is cheap insurance rather than a guess).
      `<title>${xml(title)}</title>`,
      `<link>${xml(link)}</link>`,
      `<g:title>${xml(title)}</g:title>`,
      `<g:description>${xml(clamp(plain(p.description || p.name), 5000))}</g:description>`,
      `<g:link>${xml(link)}</g:link>`,
      `<g:image_link>${xml(image)}</g:image_link>`,
      // Up to 10 extras (Google's cap; Meta allows 20, TikTok 10 — the lowest common limit wins).
      ...extraImages(gallery(p).slice(0, 10).map((u) => abs(u, origin)), profile),
      `<g:availability>${availability(v.stock)}</g:availability>`,
      `<g:price>${listPrice} IDR</g:price>`,
      salePrice !== null ? `<g:sale_price>${salePrice} IDR</g:sale_price>` : "",
      // WITH an end date when the discount is a timed flash sale. Feeds are polled hourly at best, so
      // without it the provider goes on advertising the sale price after it has lapsed — the same
      // "price we will not honour" failure as the ratio bug above, pointing the other way.
      salePrice !== null && p.flashEndsAt ? `<g:sale_price_effective_date>${xml(saleWindow(p.flashEndsAt))}</g:sale_price_effective_date>` : "",
      `<g:brand>${xml(brand)}</g:brand>`,
      `<g:condition>new</g:condition>`,
      gtin ? `<g:gtin>${xml(gtin)}</g:gtin>` : "",
      mpn ? `<g:mpn>${xml(clamp(mpn, 70))}</g:mpn>` : "",
      !gtin && !mpn ? `<g:identifier_exists>no</g:identifier_exists>` : "",
      category ? `<g:google_product_category>${xml(category)}</g:google_product_category>` : "",
      p.category ? `<g:product_type>${xml(clamp(p.category, 750))}</g:product_type>` : "",
      gender ? `<g:gender>${xml(gender)}</g:gender>` : "",
      ageGroup ? `<g:age_group>${xml(ageGroup)}</g:age_group>` : "",
      color ? `<g:color>${xml(clamp(color, 100))}</g:color>` : "",
      size ? `<g:size>${xml(clamp(size, 100))}</g:size>` : "",
      p.material ? `<g:material>${xml(clamp(p.material, 200))}</g:material>` : "",
    ].filter(Boolean);
    return [`<item>${lines.join("")}</item>`];
  });
}

/** The full RSS document. */
export function feedDocument(args: { storeName: string; origin: string; items: string[] }): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">` +
    `<channel>` +
    `<title>${xml(args.storeName)}</title>` +
    `<link>${xml(args.origin)}</link>` +
    `<description>${xml(`Katalog produk ${args.storeName}`)}</description>` +
    args.items.join("") +
    `</channel></rss>`
  );
}
