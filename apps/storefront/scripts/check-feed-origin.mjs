// Prove the product feeds emit the tenant's CANONICAL origin — the one `src/middleware.ts` computes as
// `locals.origin` (`primaryOrigin()`: the active primary custom domain over https, else the request's
// forwarded scheme + host) — and never an origin of their own.
//
// Page-map finding SF-1 (2026-09-07): `/feed/google.xml` and `/feed/tiktok.xml` rebuilt the origin as
// `https://${Host}` from the raw header, ignoring `x-forwarded-*` and the store's primary custom
// domain, while `/sitemap.xml` and every canonical read `locals.origin`. One catalogue, two origins —
// and Meta, Google and TikTok all match a feed item to a landing page BY URL, so the split does not
// degrade matching, it defeats it. Nothing importable holds this claim: it lives in the seam between
// the middleware and two endpoints, so it is an HTTP check.
//
// Two claims, each asserted on BOTH feeds and reconciled against the sitemap of the same request:
//   1. A store WITHOUT a custom domain, reached through a proxy (`x-forwarded-host` / `-proto` that
//      differ from the raw Host): the feeds follow the forwarded origin — the sitemap already did.
//      This is the case the old code got wrong, so it is the one that goes red on a regression.
//      SKIP (exit 2) when the database holds no such store — that is data, not code.
//   2. The base tenant (`CHECK_BASE_URL`'s host — the demo store's primary custom domain) with a
//      forwarded scheme that disagrees: feed origin === sitemap origin. A primary domain is canonical
//      over https regardless of how the request arrived; the feeds must agree with the sitemap on that.
//
// Reads the dev database (one SELECT) to find a subdomain-only store; writes nothing.
//
// Normally run by the suite:  npm run verify -w @tokophi/storefront
// Standalone, against a storefront you already have running (see check-env.mjs for the contract):
//   CHECK_BASE_URL=http://toko-demo.test:4390 node apps/storefront/scripts/check-feed-origin.mjs
import http from "node:http";
import postgres from "postgres";
import { HOSTNAME, NOT_APPLICABLE, PORT, requireDatabaseUrl } from "./check-env.mjs";

const FEEDS = ["/feed/google.xml", "/feed/tiktok.xml"];

/** GET as a tenant with extra headers. `fetch` cannot send a Host header (check-env.mjs), and this
 *  check ALSO needs `x-forwarded-*`, which `getAsTenant` does not take. */
const get = (pathname, headers) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathname, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });

/** The channel `<link>` (the feed's own statement of its origin) plus every item/image URL. */
const feedUrls = (xml) => ({
  channel: /<channel>[\s\S]*?<link>([^<]*)<\/link>/.exec(xml)?.[1] ?? null,
  items: [...xml.matchAll(/<(?:g:link|g:image_link|g:additional_image_link)>([^<]*)</g)].map((m) => m[1]),
});
const sitemapOrigin = (xml) => {
  const loc = /<loc>([^<]*)<\/loc>/.exec(xml)?.[1];
  return loc ? new URL(loc).origin : null;
};
// Merchant uploads are served by the admin (`/api/uploads/*` on PUBLIC_ONGKIR_API), so an image URL
// on another origin is by design; product/landing links are the ones that must match.
const isStoreUrl = (u) => !/\/api\/uploads\//.test(u);

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const assertFeedsAgree = async (label, headers, expectedOrigin) => {
  const sitemap = await get("/sitemap.xml", headers);
  check(`${label}: sitemap answers 200`, sitemap.status === 200, `HTTP ${sitemap.status}`);
  const smOrigin = sitemapOrigin(sitemap.body);
  check(`${label}: sitemap origin is ${expectedOrigin}`, smOrigin === expectedOrigin, `got ${smOrigin}`);
  for (const path of FEEDS) {
    const res = await get(path, headers);
    check(`${label}: ${path} answers 200`, res.status === 200, `HTTP ${res.status}`);
    if (res.status !== 200) continue;
    const { channel, items } = feedUrls(res.body);
    check(`${label}: ${path} <link> is ${expectedOrigin}`, channel === expectedOrigin, `got ${channel}`);
    const stray = items.filter(isStoreUrl).filter((u) => !u.startsWith(`${expectedOrigin}/`));
    check(
      `${label}: ${path} every product link is under ${expectedOrigin}`,
      stray.length === 0,
      stray.length ? `${stray.length} elsewhere, e.g. ${stray[0]}` : `${items.length} item URLs`,
    );
  }
};

// ── 1. a subdomain-only store behind a proxy ────────────────────────────────────────────────────
const sql = postgres(requireDatabaseUrl(), { max: 1 });
let subdomainOnly;
try {
  // Mirrors `isPubliclyServable` in src/data/store.ts: approved and not suspended, else the
  // middleware answers 503 and no feed is served. "No active primary domain" = the subdomain is primary.
  [subdomainOnly] = await sql`
    select s.slug from stores s
     where s.approved_at is not null and s.suspended_at is null
       and not exists (select 1 from store_domains d
                        where d.store_id = s.id and d.status = 'active' and d.is_primary)
     order by s.slug limit 1`;
} finally {
  await sql.end();
}

if (!subdomainOnly) {
  console.log("SKIP  every servable store has a primary custom domain — claim 1 has no subject in this database");
} else {
  // The runner starts the server with STOREFRONT_BASE_DOMAIN=test, so `<slug>.test` resolves the store
  // (slugFromBaseDomain) — the same way `<slug>.tokophi.id` does in production.
  const host = `${subdomainOnly.slug}.test`;
  const fwdHost = "feed-origin-check.example.test";
  await assertFeedsAgree(
    `${host} via proxy (x-forwarded-host: ${fwdHost}, x-forwarded-proto: http)`,
    { Host: host, "x-forwarded-host": fwdHost, "x-forwarded-proto": "http" },
    `http://${fwdHost}`,
  );
}

// ── 2. the base tenant, forwarded scheme disagreeing ────────────────────────────────────────────
// Whatever `primaryOrigin` decides for this host, the feeds and the sitemap must decide it TOGETHER.
// The expected value is read off the sitemap rather than asserted, because the demo store's primary
// domain is data: with one it is `https://<host>` regardless of the forwarded scheme, without one it
// follows the scheme. Either way, one origin.
const base = await get("/sitemap.xml", { Host: HOSTNAME, "x-forwarded-proto": "http" });
const baseOrigin = sitemapOrigin(base.body);
check(`${HOSTNAME}: sitemap names an origin`, !!baseOrigin, `HTTP ${base.status}`);
if (baseOrigin) {
  await assertFeedsAgree(`${HOSTNAME} (x-forwarded-proto: http)`, { Host: HOSTNAME, "x-forwarded-proto": "http" }, baseOrigin);
}

if (!subdomainOnly && failures === 0) process.exit(NOT_APPLICABLE);
console.log(failures ? `\n${failures} failed` : "\nfeed origins agree with the canonical origin");
process.exit(failures ? 1 : 0);
