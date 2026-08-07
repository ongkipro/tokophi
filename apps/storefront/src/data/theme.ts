// ADR 0009 — Store Builder. The store's page templates + brand colour scale.
// Per-store + per-request (no module-level await): called from getCatalog(store), cached with it.
import { db, schema } from "@tokophi/db";
import { eq } from "drizzle-orm";
import type { StoredTemplateData } from "@tokophi/sections";
import { themeSourceStoreId } from "./theme-source";
import { generateBrandShades, DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";

/**
 * Full brand shade scale derived from the store's chosen hex (or the platform default) —
 * Layout.astro injects these as CSS custom-property overrides so every `bg-brand-*`/`text-brand-*`
 * utility already in the storefront's markup picks up the merchant's colour.
 */
export const brandShadesFor = (brandColor: string | null | undefined): Record<string, string> =>
  generateBrandShades(brandColor ?? DEFAULT_BRAND_COLOR);

/**
 * Every template the store has built, in ONE query (they're small, and the catalog is memoized
 * per store — so a page view costs 0 extra round-trips, and certainly none per section rendered).
 *
 * `byId` only holds templates with content, so a collection/product pointing at an EMPTY named
 * template still degrades to the type default (and then to the hand-built page) instead of
 * rendering a blank page.
 */
export type StoreTemplates = {
  /** `homepage` + is_default, or null → the hand-built default homepage. */
  homepage: StoredTemplateData | null;
  /** `category` + is_default, or null → the hand-built category page. */
  categoryDefault: StoredTemplateData | null;
  /** `product` + is_default, or null → the hand-built product tail (Rekomendasi). */
  productDefault: StoredTemplateData | null;
  /** Named variants (any type) keyed by id — the target of collections/products.template_id. */
  byId: Record<string, StoredTemplateData>;
};

const EMPTY_TEMPLATES: StoreTemplates = {
  homepage: null,
  categoryDefault: null,
  productDefault: null,
  byId: {},
};

/** A template only counts if the merchant actually put something in it. */
const withContent = (sections: unknown): StoredTemplateData | null => {
  const data = sections as StoredTemplateData | null;
  return data && Array.isArray(data.content) && data.content.length > 0 ? data : null;
};

export async function getStoreTemplates(storeId: string): Promise<StoreTemplates> {
  // Resolved ONCE, here, because this is the single seam every template read passes through. Doing it
  // at a call site would leave the other call sites serving the merchant's own theme.
  storeId = themeSourceStoreId(storeId);
  const rows = await db
    .select({
      id: schema.pageTemplates.id,
      type: schema.pageTemplates.type,
      isDefault: schema.pageTemplates.isDefault,
      sections: schema.pageTemplates.sections,
    })
    .from(schema.pageTemplates)
    .where(eq(schema.pageTemplates.storeId, storeId));

  const templates: StoreTemplates = { ...EMPTY_TEMPLATES, byId: {} };

  for (const row of rows) {
    const data = withContent(row.sections);
    if (!data) continue;
    templates.byId[row.id] = data;
    if (!row.isDefault) continue;
    if (row.type === "homepage") templates.homepage ??= data;
    else if (row.type === "category") templates.categoryDefault ??= data;
    else if (row.type === "product") templates.productDefault ??= data;
  }

  return templates;
}

/**
 * The template that renders a page: the row explicitly assigned to this collection/product
 * (`template_id`) → else the store's default for that type → else null (hand-built fallback).
 */
export const resolveTemplate = (
  templates: StoreTemplates,
  templateId: string | null | undefined,
  fallback: StoredTemplateData | null,
): StoredTemplateData | null => (templateId ? (templates.byId[templateId] ?? fallback) : fallback);
