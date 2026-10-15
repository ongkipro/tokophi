/** A post-sign-in destination: a path on THIS origin only (no `//host`, no scheme) — never an open redirect. */
export function safeNext(raw: string | null | undefined): string {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") && raw.length < 300 ? raw : "/";
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
