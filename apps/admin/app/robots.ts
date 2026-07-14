import type { MetadataRoute } from "next";

// app.tokophi.com = Dashboard Seller (merchant). Nothing here is public: block every crawler outright —
// EXCEPT /api/uploads/*, the merchant-uploaded product photos that the public storefronts embed
// from this origin (storefront `mediaUrl()`). Without this Allow, `Disallow: /` would stop
// Googlebot-Image from ever fetching them and every merchant's product images would vanish from
// Google Images. `Allow` wins over `Disallow` on the more specific path.
// (The storefronts and the landing page are separate apps and stay indexable.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/api/uploads/", disallow: "/" },
  };
}
