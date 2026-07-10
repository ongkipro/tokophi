import type { Config, CustomField } from "@measured/puck";
import { SECTION_DEFAULTS, type SectionConfigMap, type ColorPalette } from "@tokophi/sections";
import { FieldWrapper } from "@/lib/theme/puck-field-overrides";
import { Hero } from "@/components/theme/sections/Hero";
import { ProductGrid } from "@/components/theme/sections/ProductGrid";
import { BannerPromo } from "@/components/theme/sections/BannerPromo";
import { Testimoni } from "@/components/theme/sections/Testimoni";
import { ImageText } from "@/components/theme/sections/ImageText";
import { Marquee } from "@/components/theme/sections/Marquee";
import { RichText } from "@/components/theme/sections/RichText";
import { CategoryNav } from "@/components/theme/sections/CategoryNav";

// ADR 0009 amendment 2 ("Palet Warna") — a `custom` field (not `select`) because the option
// list is the store's own palettes, fetched at request time, not a static array known when this
// module loads. Shared by every section below so the picker looks/behaves identically everywhere.
function paletteField(palettes: ColorPalette[]): CustomField<string> {
  return {
    type: "custom",
    label: "Palet Warna",
    render: ({ value, onChange }) => (
      <FieldWrapper label="Palet Warna" name="paletteId">
        <select
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Default toko</option>
          {palettes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </FieldWrapper>
    ),
  };
}

// ADR 0009 — the Puck `Config` is the admin-side half of the section registry
// (@tokophi/sections/registry.ts is the shared shape; apps/storefront's Astro components are
// the other half). Puck's component keys must match `SectionType` from the registry so
// `page_templates.sections[].type` round-trips cleanly between the builder and the renderer.
//
// A factory (not a static export) because the palette picker's options depend on the store's
// current palette list, fetched server-side and passed in once when TemaClient mounts.
export function buildPuckConfig(palettes: ColorPalette[]): Config<SectionConfigMap> {
  const paletteId = paletteField(palettes);
  return {
    components: {
      hero: {
        label: "Hero",
        fields: {
          badge: { type: "text", label: "Label Badge (kosong = sembunyi)" },
          heading: { type: "text", label: "Judul" },
          subheading: { type: "textarea", label: "Sub-judul" },
          imageUrl: { type: "text", label: "URL Gambar" },
          ctaLabel: { type: "text", label: "Teks Tombol" },
          ctaHref: { type: "text", label: "Link Tombol" },
          ratingText: { type: "text", label: "Teks Rating/Sosial (kosong = sembunyi)" },
          align: {
            type: "select",
            label: "Perataan",
            options: [
              { label: "Kiri", value: "left" },
              { label: "Tengah", value: "center" },
            ],
          },
          paletteId,
        },
        defaultProps: SECTION_DEFAULTS.hero,
        render: (props) => <Hero {...props} palettes={palettes} />,
      },
      "product-grid": {
        label: "Grid Produk",
        fields: {
          heading: { type: "text", label: "Judul" },
          mode: {
            type: "select",
            label: "Produk yang Ditampilkan",
            options: [
              { label: "Terlaris", value: "terlaris" },
              { label: "Terbaru", value: "terbaru" },
              { label: "Acak", value: "acak" },
            ],
          },
          collectionHandle: { type: "text", label: "Handle Kategori (kosong = semua)" },
          limit: { type: "number", label: "Jumlah Produk", min: 2, max: 24 },
          columns: {
            type: "select",
            label: "Kolom",
            options: [
              { label: "2", value: 2 },
              { label: "3", value: 3 },
              { label: "4", value: 4 },
            ],
          },
          paletteId,
        },
        defaultProps: SECTION_DEFAULTS["product-grid"],
        render: (props) => <ProductGrid {...props} palettes={palettes} />,
        // Max 2 Grid Produk sections per page — once reached, disable inserting a 3rd
        // (official Puck extension point, not a save-time rejection UX).
        resolvePermissions: (_data, { appState }) => {
          const count = appState.data.content.filter((item) => item.type === "product-grid").length;
          return { insert: count < 2 };
        },
      },
      "banner-promo": {
        label: "Banner Promo",
        fields: {
          heading: { type: "text", label: "Judul" },
          subheading: { type: "textarea", label: "Sub-judul" },
          imageUrl: { type: "text", label: "URL Gambar" },
          href: { type: "text", label: "Link" },
          badge: { type: "text", label: "Label Badge" },
          paletteId,
        },
        defaultProps: SECTION_DEFAULTS["banner-promo"],
        render: (props) => <BannerPromo {...props} palettes={palettes} />,
      },
      testimoni: {
        label: "Testimoni",
        fields: {
          heading: { type: "text", label: "Judul" },
          items: {
            type: "array",
            label: "Testimoni",
            arrayFields: {
              name: { type: "text", label: "Nama" },
              quote: { type: "textarea", label: "Kutipan" },
              rating: {
                type: "select",
                label: "Rating",
                options: [1, 2, 3, 4, 5].map((n) => ({ label: `${n} bintang`, value: n })),
              },
            },
          },
          paletteId,
        },
        defaultProps: SECTION_DEFAULTS.testimoni,
        render: (props) => <Testimoni {...props} palettes={palettes} />,
      },
      "image-text": {
        label: "Gambar + Teks",
        fields: {
          eyebrow: { type: "text", label: "Label Kecil (kosong = sembunyi)" },
          heading: { type: "text", label: "Judul" },
          body: { type: "textarea", label: "Isi Teks" },
          imageUrl: { type: "text", label: "URL Gambar" },
          imageSide: {
            type: "select",
            label: "Posisi Gambar",
            options: [
              { label: "Kiri", value: "left" },
              { label: "Kanan", value: "right" },
            ],
          },
          paletteId,
        },
        defaultProps: SECTION_DEFAULTS["image-text"],
        render: (props) => <ImageText {...props} palettes={palettes} />,
      },
      marquee: {
        label: "Teks Berjalan",
        fields: {
          text: { type: "text", label: "Teks yang Berjalan" },
          speed: {
            type: "select",
            label: "Kecepatan",
            options: [
              { label: "Lambat", value: "lambat" },
              { label: "Sedang", value: "sedang" },
              { label: "Cepat", value: "cepat" },
            ],
          },
          paletteId,
        },
        defaultProps: SECTION_DEFAULTS.marquee,
        render: (props) => <Marquee {...props} palettes={palettes} />,
      },
      "rich-text": {
        label: "Teks & Pernyataan",
        fields: {
          heading: { type: "text", label: "Judul" },
          body: { type: "textarea", label: "Isi Teks" },
          ctaLabel: { type: "text", label: "Teks Tombol (kosong = sembunyi)" },
          ctaHref: { type: "text", label: "Link Tombol" },
          theme: {
            type: "select",
            label: "Gaya (dipakai kalau Palet Warna = Default toko)",
            options: [
              { label: "Terang", value: "terang" },
              { label: "Gelap", value: "gelap" },
            ],
          },
          paletteId,
        },
        defaultProps: SECTION_DEFAULTS["rich-text"],
        render: (props) => <RichText {...props} palettes={palettes} />,
      },
      "category-nav": {
        label: "Navigasi Kategori",
        fields: {
          items: {
            type: "array",
            label: "Kategori",
            arrayFields: {
              label: { type: "text", label: "Nama Kategori" },
              imageUrl: { type: "text", label: "URL Gambar" },
              href: { type: "text", label: "Link" },
            },
          },
          paletteId,
        },
        defaultProps: SECTION_DEFAULTS["category-nav"],
        render: (props) => <CategoryNav {...props} palettes={palettes} />,
      },
    },
  };
}
