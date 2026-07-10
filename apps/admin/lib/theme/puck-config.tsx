import type { Config } from "@measured/puck";
import { SECTION_DEFAULTS, type SectionConfigMap } from "@tokophi/sections";
import { Hero } from "@/components/theme/sections/Hero";
import { ProductGrid } from "@/components/theme/sections/ProductGrid";
import { BannerPromo } from "@/components/theme/sections/BannerPromo";
import { Testimoni } from "@/components/theme/sections/Testimoni";
import { ImageText } from "@/components/theme/sections/ImageText";
import { Marquee } from "@/components/theme/sections/Marquee";
import { RichText } from "@/components/theme/sections/RichText";
import { CategoryNav } from "@/components/theme/sections/CategoryNav";

// ADR 0009 — the Puck `Config` is the admin-side half of the section registry
// (@tokophi/sections/registry.ts is the shared shape; apps/storefront's Astro components are
// the other half). Puck's component keys must match `SectionType` from the registry so
// `page_templates.sections[].type` round-trips cleanly between the builder and the renderer.
export const puckConfig: Config<SectionConfigMap> = {
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
      },
      defaultProps: SECTION_DEFAULTS.hero,
      render: (props) => <Hero {...props} />,
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
      },
      defaultProps: SECTION_DEFAULTS["product-grid"],
      render: (props) => <ProductGrid {...props} />,
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
      },
      defaultProps: SECTION_DEFAULTS["banner-promo"],
      render: (props) => <BannerPromo {...props} />,
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
      },
      defaultProps: SECTION_DEFAULTS.testimoni,
      render: (props) => <Testimoni {...props} />,
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
      },
      defaultProps: SECTION_DEFAULTS["image-text"],
      render: (props) => <ImageText {...props} />,
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
      },
      defaultProps: SECTION_DEFAULTS.marquee,
      render: (props) => <Marquee {...props} />,
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
          label: "Gaya",
          options: [
            { label: "Terang", value: "terang" },
            { label: "Gelap", value: "gelap" },
          ],
        },
      },
      defaultProps: SECTION_DEFAULTS["rich-text"],
      render: (props) => <RichText {...props} />,
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
      },
      defaultProps: SECTION_DEFAULTS["category-nav"],
      render: (props) => <CategoryNav {...props} />,
    },
  },
};
