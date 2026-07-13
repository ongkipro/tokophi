// Multi-tenant entry point (ADR 0009 / PROD_PLAN §5): resolve the store from the request's
// `Host` header, load its catalog, and hand both to every page/component via `Astro.locals`.
// One deploy serves every store — no per-client build, no STORE_SLUG-per-deploy.
import { defineMiddleware } from "astro:middleware";
import { getStoreByHost, normalizeHost } from "./data/store";
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
  return next();
});
