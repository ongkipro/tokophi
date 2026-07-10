// ADR 0009 — Store Builder. Reads the store's active homepage template (if the merchant has
// saved one via the admin's Store Builder). Same top-level-await/single-tenant pattern as
// catalog.ts — later parameterized by store_id/STORE_SLUG alongside it (ADR 0008/0009).
import { db, schema } from "@tokophi/db";
import { and, eq } from "drizzle-orm";
import type { ColorPalette, StoredTemplateData } from "@tokophi/sections";
import { generateBrandShades, DEFAULT_BRAND_COLOR } from "@tokophi/lib/colors";
import { STORE_ID, STORE } from "./catalog";

// Full brand shade scale derived from the store's chosen hex (or the default) — Layout.astro
// injects these as CSS custom-property overrides so every `bg-brand-*`/`text-brand-*` utility
// (already used throughout the storefront's hand-styled markup) picks up the merchant's colour.
export const BRAND_SHADES = generateBrandShades(STORE.brandColor ?? DEFAULT_BRAND_COLOR);

// "Palet Warna" (ADR 0009 amendment 2) — read-only here; the admin's getOrSeedPalettes()
// is what creates the store's first two palettes, so by the time the storefront reads them
// there's always at least the seeded "Terang"/"Gelap" pair.
export const PALETTES: ColorPalette[] = await db
  .select()
  .from(schema.colorPalettes)
  .where(eq(schema.colorPalettes.storeId, STORE_ID));

const [homepageRow] = await db
  .select()
  .from(schema.pageTemplates)
  .where(
    and(
      eq(schema.pageTemplates.storeId, STORE_ID),
      eq(schema.pageTemplates.type, "homepage"),
      eq(schema.pageTemplates.isDefault, true),
    ),
  )
  .limit(1);

// null = merchant hasn't built a homepage yet — the page falls back to the hand-built default.
export const HOMEPAGE_TEMPLATE: StoredTemplateData | null =
  homepageRow && (homepageRow.sections as StoredTemplateData).content?.length
    ? (homepageRow.sections as StoredTemplateData)
    : null;
