/** A post-sign-in destination: a path on THIS origin only — never an open redirect. Resolved the way
 *  the browser will resolve `Location` (the URL parser drops tabs/newlines, so "/\t/evil" is "//evil"),
 *  and only a same-origin result survives, re-serialised. */
export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.length >= 300) return "/";
  try {
    const u = new URL(raw, "http://self.invalid");
    return u.origin === "http://self.invalid" ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}

/** Redirect to sign-in, remembering where the visitor was going. */
export function signInUrl(url: URL): string {
  return `/masuk?next=${encodeURIComponent(url.pathname + url.search)}`;
}

/** The store's public storefront (the share link's base). */
export function storefrontOrigin(slug: string): string {
  const base = (process.env.STOREFRONT_BASE_DOMAIN || "tokophi.id").trim().replace(/^\.+/, "");
  return `https://${slug}.${base}`;
}
