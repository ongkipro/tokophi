// deploy-marker 2026-08-28: measures the consistent-container-name surgical recreate (BUILD-LOG).
// robots.txt — PER REQUEST, not a static file.
//
// It cannot live in `public/`: one deploy serves every merchant (ADR 0009), so a static file would
// hand every store the same `Sitemap:` line pointing at whichever host got baked in. Worse than
// having none.
//
// The cart, checkout and API routes are currently fully crawlable. They are thin, per-shopper and
// duplicate — every crawl of them is crawl budget stolen from the catalogue, which is the only part
// of the shop that earns anything.
//
// ⚠️ WHAT YOU SEE AT /robots.txt IS NOT THIS FILE. Cloudflare's **Managed robots.txt** prepends ~60
// lines to it — a Content Signals preamble, `Content-Signal: search=yes,ai-train=no,use=reference`,
// and an AI-crawler block-list (GPTBot, ClaudeBot, CCBot, Google-Extended, Bytespider…). Live is 70
// lines; this file emits 9. Do not "reconcile" them: the difference is a zone setting, not a bug.
//
// ⚠️ AND DO NOT CHASE THE LIGHTHOUSE FAILURE. `robots-txt` scores **0** on live — "Unknown directive"
// at the `Content-Signal:` line. Measured 2026-07-17. It is the AUDIT that is behind, not the file,
// and Google's own spec says so on both counts:
//   · "Rules other than `allow`, `disallow`, and `user-agent` are ignored by the robots.txt parser."
//     Unknown lines do not invalidate anything — `Sitemap:` below is itself such an extension, and
//     nobody calls a file broken for having one.
//   · Cloudflare's block declares its own `User-agent: *`, so live has TWO. That looked like it might
//     shadow our Disallows — it does not: "If there's more than one specific group declared for a
//     user agent, all the rules from the groups applicable to the specific user agent are combined
//     internally into a single group." Our `Disallow: /checkout` applies. Verified against
//     developers.google.com/crawling/docs/robots-txt/robots-txt-spec, not assumed.
//
// So the only way to make that audit pass is to switch Managed robots.txt off in Cloudflare — which
// would delete an AI-training opt-out that the injected text states is an **express reservation of
// rights under Article 4 of EU Directive 2019/790**. Trading that for 8 points on a linter is a bad
// trade. If someone decides otherwise, it is a Cloudflare zone setting; there is nothing to change here.
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
