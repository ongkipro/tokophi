// Breadcrumbs — ONE definition of the trail, used for both the UI and the schema.
//
// They already existed as SIX hand-copied blocks of identical markup (kategori, produk, halaman,
// blog/index, kontak, keranjang), and `BreadcrumbList` schema existed on exactly ONE page (the PDP).
// That split is the bug worth fixing: a page whose schema and whose visible trail are typed out
// separately will eventually disagree, and a BreadcrumbList that does not match what the shopper can
// see is precisely what Google's structured-data guidelines call out. Build both from one array.

export type Crumb = {
  name: string;
  /** Absent (or on the LAST crumb) = the page you are already on — rendered as text, never a link. */
  href?: string;
};

/**
 * `BreadcrumbList` JSON-LD. `origin` is per-request (`Astro.locals.origin`) because one deploy serves
 * every merchant — a baked host would publish another store's URLs into this store's schema.
 *
 * The final crumb deliberately carries NO `item`: it is the current page, and schema.org's own
 * guidance is that the trailing element may omit it. Emitting a self-link there adds nothing.
 */
export function breadcrumbLd(items: Crumb[], origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.href && i < items.length - 1 ? { item: new URL(c.href, origin).href } : {}),
    })),
  };
}

/**
 * Serialise JSON-LD for a `<script type="application/ld+json">`.
 *
 * ⚠️ The `<` escape is not cosmetic. Merchant text (a product name, a category blurb) flows into this
 * string, so a name containing `</script>` would otherwise close the tag and inject markup into the
 * page — from the seller's own admin, but a hole is a hole.
 */
export const ldScript = (ld: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
