// ADR 0009 — Store Builder. The store's active homepage template + brand colour scale.
// Per-store + per-request (no module-level await): called from getCatalog(store), cached with it.
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import type { StoredTemplateData } from "@tokophi/sections";
import { generateBrandShades, DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";

/**
 * Full brand shade scale derived from the store's chosen hex (or the platform default) —
 * Layout.astro injects these as CSS custom-property overrides so every `bg-brand-*`/`text-brand-*`
 * utility already in the storefront's markup picks up the merchant's colour.
 */
export const brandShadesFor = (brandColor: string | null | undefined): Record<string, string> =>
  generateBrandShades(brandColor ?? DEFAULT_BRAND_COLOR);

/** null = merchant hasn't built a homepage yet → the page falls back to the hand-built default. */
export async function getHomepageTemplate(storeId: string): Promise<StoredTemplateData | null> {
  const [row] = await db
    .select()
    .from(schema.pageTemplates)
    .where(
      and(
        eq(schema.pageTemplates.storeId, storeId),
        eq(schema.pageTemplates.type, "homepage"),
        eq(schema.pageTemplates.isDefault, true),
      ),
    )
    .limit(1);

  return row && (row.sections as StoredTemplateData).content?.length
    ? (row.sections as StoredTemplateData)
    : null;
}
