import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

export const collections = {
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // Seller routes the page describes; checked against specs/docs/page-map.json (spec §10).
        routes: z.array(z.string().startsWith("/")).optional(),
        // Full <title> text before the brand suffix (55–70 chars total incl. suffix; see routeData.ts).
        seoTitle: z.string().optional(),
        // The date the page's facts were last checked against the code.
        verified: z.coerce.date().optional(),
      }),
    }),
  }),
};
