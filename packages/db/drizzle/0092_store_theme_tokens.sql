-- Per-tenant design tokens beyond the single brand colour (@tokophi/lib/theme).
--
-- The storefront's neutrals (surface/text/border), fonts and whole "batik boutique" vibe were
-- hardcoded in apps/storefront global.css — every tenant got the demo store's look with only the
-- brand hue swapped. `theme` stores the store's OTHER dials as jsonb `{ font, tone }`:
--   font — curated pairing id (elegan | modern | klasik | tegas), loaded by Layout.astro;
--   tone — neutral temperature (hangat | netral | sejuk); the full neutral palette is DERIVED
--          from brand_color × tone by resolveTheme(), one function, storefront + admin preview.
--
-- jsonb, not columns: the resolver validates and defaults every field (garbage degrades to the
-- original look, never a crash), and future dials (radius, dark) land without another migration.
-- NULL = the original elegan/hangat look — every existing store renders UNCHANGED until its
-- owner picks something. The Batik Nusantara demo gets the preset explicitly via seed, making
-- the batik look that store's CHOICE instead of the platform default.
--
-- Idempotent on purpose (AGENTS.md): drizzle applies the pending batch in ONE transaction, so a
-- single "already exists" rolls back every migration behind it.
alter table "stores" add column if not exists "theme" jsonb;

comment on column "stores"."theme" is
  'Design-token choices beyond brand_color: { font, tone } (@tokophi/lib/theme StoreTheme). NULL = original elegan/hangat look. Validated by resolveTheme(); unknown values degrade to defaults.';
