// Multi-tenant entry point (ADR 0009 / PROD_PLAN §5): resolve the store from the request's
// `Host` header, load its catalog, and hand both to every page/component via `Astro.locals`.
// One deploy serves every store — no per-client build, no STORE_SLUG-per-deploy.
import { defineMiddleware } from "astro:middleware";
import { getStoreByHost, normalizeHost, primaryOrigin } from "./data/store";
import { getCatalog } from "./data/catalog";

const notFoundHtml = (host: string) => `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Toko tidak ditemukan — TokoΦ</title>
    <style>
      body { margin:0; min-height:100vh; display:grid; place-items:center; background:#fdfbf7; color:#2a2523;
             font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding:2rem; }
      main { max-width:32rem; text-align:center; }
      h1 { font-size:1.75rem; margin:0 0 .75rem; font-weight:600; }
      p { margin:0; color:#7c716c; line-height:1.6; }
      code { background:#f1ece5; padding:.15rem .4rem; border-radius:.35rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Toko tidak ditemukan</h1>
      <p>Tidak ada toko yang terdaftar di alamat <code>${host.replace(/[<>&"]/g, "")}</code>.</p>
      <p style="margin-top:1rem">Ditenagai TokoΦ.</p>
    </main>
  </body>
</html>
`;

export const onRequest = defineMiddleware(async (context, next) => {
  const host = normalizeHost(context.request.headers.get("host") ?? context.url.host);
  const store = await getStoreByHost(host);

  // Unknown host and no fallback store configured → clean 404, never a 500.
  if (!store) {
    return new Response(notFoundHtml(host), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  context.locals.store = store;
  context.locals.catalog = await getCatalog(store);

  // The canonical ORIGIN for THIS request. There is no correct value to bake in: one deploy serves
  // every merchant, so the right host is whatever the shopper actually landed on — a custom domain,
  // a <slug>.tokophi.com subdomain, or localhost.
  //
  // Built from headers, not from `Astro.url`: behind Cloudflare the Node adapter sees plain HTTP on
  // the origin, so `Astro.url.protocol` yields `http://` — canonicals that point at a URL which 301s,
  // wasting a redirect hop on every crawl. `x-forwarded-proto` is the truth.
  const proto = context.request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  const fwdHost = context.request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const rawHost = fwdHost || context.request.headers.get("host") || context.url.host;
  // localhost has no TLS in dev — emitting https:// there would break every link we print.
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(rawHost) ? "http" : proto;

  // The PRIMARY origin — not merely the one this request arrived on.
  //
  // A store is ALWAYS reachable at <slug>.tokophi.com. Once custom domains land, the same catalogue is
  // reachable at two hosts, and if both are indexable Google sees a full duplicate of every product
  // page and both hosts lose. So exactly ONE host is canonical, and canonicals / og:url / the sitemap
  // must all be built from it — never from whichever host the shopper happened to type.
  //
  // Today there are no custom domains, so the subdomain IS the primary and this is a no-op. The seam
  // is here now so that adding `stores.custom_domain` later is a one-line change in primaryOrigin()
  // instead of a hunt through every place a URL is emitted.
  context.locals.origin = primaryOrigin(store, `${scheme}://${rawHost}`);

  return next();
});
