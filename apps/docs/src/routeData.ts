import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

// Owner SEO invariant: <title> is "{page} - {brand}", 55–70 characters, never "|" (checked by
// scripts/check-seo.mjs). `seoTitle` lets a short on-page H1 carry a fuller, natural title; the
// home page's seoTitle is the whole title (no suffix).
const BRAND = "Panduan TokoΦ";

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const data = route.entry.data as { title: string; seoTitle?: string; template?: string };
  const isHome = context.url.pathname === "/";
  const full = isHome ? (data.seoTitle ?? data.title) : `${data.seoTitle ?? data.title} - ${BRAND}`;
  for (const tag of route.head) {
    if (tag.tag === "title") tag.content = full;
    if (tag.tag === "meta" && tag.attrs?.property === "og:title") tag.attrs.content = full;
  }
});
