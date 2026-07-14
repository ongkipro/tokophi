// robots.txt — PER REQUEST, not a static file.
//
// It cannot live in `public/`: one deploy serves every merchant (ADR 0009), so a static file would
// hand every store the same `Sitemap:` line pointing at whichever host got baked in. Worse than
// having none.
//
// The cart, checkout and API routes are currently fully crawlable. They are thin, per-shopper and
// duplicate — every crawl of them is crawl budget stolen from the catalogue, which is the only part
// of the shop that earns anything.
import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  const { origin } = locals;

  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    "# Per-shopper, thin, and duplicate — crawling these steals budget from the catalogue.",
    "Disallow: /keranjang",
    "Disallow: /checkout",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Short: a merchant attaching a custom domain must see the new Sitemap line quickly.
      "cache-control": "public, max-age=300",
    },
  });
};
