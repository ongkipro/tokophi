import type { APIRoute } from "astro";

// Sitemap for the apex (tokophi.com). Generated at build time from the pages that actually exist,
// so a new .astro page shows up here automatically instead of silently going missing from the
// index. No @astrojs/sitemap dependency on purpose — the landing app stays zero-dep and static.
//
// NOTE: this covers the LANDING origin only. robots.txt is per-origin, so the admin panels
// (app./rich.) carry their own `Disallow: /`, and each merchant storefront serves its own.
const SITE = (import.meta.env.SITE ?? "https://tokophi.com").replace(/\/$/, "");

const routes = Object.keys(import.meta.glob("./**/*.astro"))
  .map((f) => f.replace(/^\.\//, "").replace(/\.astro$/, ""))
  // Skip Astro partials (_foo) and dynamic routes ([slug]) — the latter need real params.
  .filter((r) => !r.split("/").some((seg) => seg.startsWith("_")) && !r.includes("["))
  .map((r) => (r === "index" ? "" : r.replace(/\/index$/, "")));

export const GET: APIRoute = () => {
  const urls = [...new Set(routes)]
    .sort()
    .map((r) => `  <url><loc>${SITE}/${r}${r ? "/" : ""}</loc></url>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
