// sitemap.xml — PER TENANT, per request.
//
// This is the surface with hundreds of indexable product URLs, and it had no sitemap at all (the
// landing page, which sells nothing, has one). Without it a new store is discovered only by crawling
// internal links — and a new store has close to zero inbound links, so exactly the pages that make
// money get indexed slowest.
//
// It CANNOT be a static file in `public/`: one container serves every merchant, so a baked file would
// serve one store's URLs on every other store's domain. Every URL below is built from
// `locals.origin` — the store's PRIMARY origin (src/data/store.ts `primaryOrigin()`), so a merchant
// with a custom domain never emits `<slug>.tokophi.com` URLs, and vice versa. Emitting another
// tenant's URLs, or the wrong host for this one, is a duplicate-content wound that costs both stores.
import type { APIRoute } from "astro";
import { getArticles, getPages } from "../data/content";

export const prerender = false;

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Entry = { path: string; lastmod?: Date | null; priority: string; changefreq: string };

export const GET: APIRoute = async ({ locals }) => {
  const { store, catalog, origin } = locals;

  const [articles, pages] = await Promise.all([getArticles(store.id), getPages(store.id)]);

  const entries: Entry[] = [
    { path: "/", priority: "1.0", changefreq: "daily" },
    // Every category the shop actually renders, including the virtual ones the nav links to — a URL
    // that 404s in a sitemap is a negative signal, so only list what /kategori/[handle] resolves.
    { path: "/kategori/semua", priority: "0.8", changefreq: "daily" },
    ...catalog.collections.map((c) => ({
      path: `/kategori/${c.handle}`,
      priority: "0.8",
      changefreq: "daily",
    })),
    // Products are the pages that earn. Highest priority after the homepage.
    ...catalog.products.map((p) => ({
      path: `/produk/${p.handle}`,
      priority: "0.9",
      changefreq: "weekly",
    })),
    { path: "/blog", priority: "0.6", changefreq: "weekly" },
    // Published only — getArticles/getPages hard-filter status='terbit', so a draft can never leak
    // into the sitemap and get itself crawled.
    ...articles.map((a) => ({
      path: `/blog/${a.handle}`,
      lastmod: a.publishedAt,
      priority: "0.6",
      changefreq: "monthly",
    })),
    ...pages.map((p) => ({
      path: `/halaman/${p.handle}`,
      priority: "0.4",
      changefreq: "monthly",
    })),
    { path: "/kontak", priority: "0.4", changefreq: "monthly" },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map((e) => {
    const loc = escapeXml(new URL(e.path, origin).href);
    const lastmod = e.lastmod ? `\n    <lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>` : "";
    return `  <url>
    <loc>${loc}</loc>${lastmod}
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`;
  })
  .join("\n")}
</urlset>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=600",
    },
  });
};
