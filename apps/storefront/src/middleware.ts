// Multi-tenant entry point (ADR 0009 / PROD_PLAN §5): resolve the store from the request's
// `Host` header, load its catalog, and hand both to every page/component via `Astro.locals`.
// One deploy serves every store — no per-client build, no STORE_SLUG-per-deploy.
import { defineMiddleware } from "astro:middleware";
import { getLockedStoreByHost, getStoreByHost, normalizeHost, primaryOrigin } from "./data/store";
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


const esc = (v: string) => v.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

// Two locks, two truths. Telling a merchant awaiting their first review that they were "ditangguhkan"
// would accuse them of something they did not do — see the 0090 note in packages/db/src/schema.ts.
const lockedHtml = (name: string, reason: "awaiting-first-review" | "suspended-for-cause" | null) => {
  const reviewing = reason !== "suspended-for-cause";
  const title = reviewing ? "Toko sedang ditinjau" : "Toko sedang tidak aktif";
  const body = reviewing
    ? "Toko ini baru dibuat dan sedang kami tinjau sebelum dibuka untuk umum. Prosesnya biasanya tidak lama — tidak ada yang perlu Anda perbaiki."
    : "Toko ini sedang tidak melayani pesanan untuk sementara.";
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} - ${esc(name)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#fafafa;color:#18181b;padding:1.5rem}
main{max-width:32rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .75rem}p{margin:0 0 .75rem;line-height:1.6;color:#52525b}
small{color:#a1a1aa}</style></head>
<body><main><h1>${esc(title)}</h1><p><strong>${esc(name)}</strong></p><p>${esc(body)}</p>
<p><small>Ditenagai TokoΦ.</small></p></main></body></html>`;
};

export const onRequest = defineMiddleware(async (context, next) => {
  const host = normalizeHost(context.request.headers.get("host") ?? context.url.host);

  // The canonical SCHEME + HOST for THIS request. Built from headers, not from `Astro.url`: behind
  // Cloudflare the Node adapter sees plain HTTP on the origin, so `Astro.url.protocol` yields
  // `http://` — canonicals that point at a URL which 301s, wasting a redirect hop on every crawl.
  // `x-forwarded-proto` is the truth. (Computed BEFORE store resolution because the slug-rename
  // redirect below needs the scheme on a host that no longer resolves.)
  const proto = context.request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  const fwdHost = context.request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const rawHost = fwdHost || context.request.headers.get("host") || context.url.host;
  // localhost has no TLS in dev — emitting https:// there would break every link we print.
  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(rawHost);
  const scheme = isLocal ? "http" : proto;

  // SLUG RENAME (2026-08-12): `batik-nusantara` → `batiknusantara` — the demo store's storefront
  // moved to batiknusantara.tokophi.id. The old label no longer resolves, but signed recovery/WA
  // links carrying the old host are already in shoppers' chats and search engines hold the old
  // URLs, so it answers a permanent 301 to the same path + query on the new host instead of the
  // 404 an unknown host earns. Matches exactly the two label forms the resolver reads a slug from
  // — `<slug>.<STOREFRONT_BASE_DOMAIN>` and the sslip.io first-label dev form — never a custom
  // domain that merely starts with the string. Every method redirects: the old host names no
  // tenant anymore, so there is nothing better to answer with.
  const OLD_LABEL = "batik-nusantara";
  const baseDomain = normalizeHost(process.env.STOREFRONT_BASE_DOMAIN);
  if (
    (baseDomain !== "" && host === `${OLD_LABEL}.${baseDomain}`) ||
    (host.endsWith(".sslip.io") && host.split(".")[0] === OLD_LABEL)
  ) {
    const newHost = `batiknusantara${host.slice(OLD_LABEL.length)}`;
    return Response.redirect(`${scheme}://${newHost}${context.url.pathname}${context.url.search}`, 301);
  }

  const store = await getStoreByHost(host);

  if (!store) {
    // The host may name a store that EXISTS but is locked. A bare "tidak ditemukan" reads as broken to
    // the merchant who just signed up and is checking their own shop — and the schema (0090) is explicit
    // that a fresh signup has done nothing wrong. Say which of the two it is.
    const locked = await getLockedStoreByHost(host);
    if (locked) {
      // 503, not 404: the shop is real and this is temporary. `Retry-After` keeps crawlers from
      // treating it as gone. ⚠️ Deliberately reveals only that a shop exists and is not open — never
      // its catalogue, which `getStoreBySlug` still refuses independently of this page.
      return new Response(lockedHtml(locked.name, locked.reason), {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", "retry-after": "3600", "cache-control": "no-store" },
      });
    }
    // Unknown host and no fallback store configured → clean 404, never a 500.
    return new Response(notFoundHtml(host), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  context.locals.store = store;
  context.locals.catalog = await getCatalog(store);

  // The canonical ORIGIN for THIS request (scheme/host computed at the top). There is no correct
  // value to bake in: one deploy serves every merchant, so the right host is whatever the shopper
  // actually landed on — a custom domain, a <slug>.tokophi.com subdomain, or localhost.

  // PRIMARY-DOMAIN REDIRECT (the Shopify model the seller picks in Pengaturan → Domain). When a store
  // has an ACTIVE primary custom domain and the shopper landed on a DIFFERENT host that also resolves
  // to this store — the `www` when the apex is primary (or the reverse), or the `<slug>.tokophi.id`
  // subdomain — 301 them to the one canonical host. So whichever of root/www the seller marks primary,
  // the other redirects to it, and there is never a duplicate storefront.
  //   • GET/HEAD only — a 301 turns a POST into a GET and drops the body.
  //   • never `/api/*` — the storefront POSTs to its own API (checkout-session beacons, chat);
  //     redirecting those would silently break capture. A stale page on the old host keeps working.
  // No active custom domain → `primaryHost` is null → this whole block is a no-op (today's state).
  //   • NEVER from localhost / 127.0.0.1 — that host only exists in local dev, and 301-ing it to the
  //     store's production canonical makes the site impossible to review locally (you land on the live
  //     domain). Production requests never arrive with a localhost Host, so skipping it there is a no-op.
  const primaryHost = store.primaryHost ? normalizeHost(store.primaryHost) : null;
  const method = context.request.method;
  if (
    primaryHost &&
    !isLocal &&
    primaryHost !== normalizeHost(rawHost) &&
    (method === "GET" || method === "HEAD") &&
    !context.url.pathname.startsWith("/api/")
  ) {
    return Response.redirect(`${scheme}://${primaryHost}${context.url.pathname}${context.url.search}`, 301);
  }

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
