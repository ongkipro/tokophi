import type { MetadataRoute } from "next";

// rich.tokophi.com = platform control plane. Block every crawler outright.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
