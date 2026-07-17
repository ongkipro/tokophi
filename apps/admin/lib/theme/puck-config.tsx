import type { Config } from "@measured/puck";
import { SECTION_DEFAULTS, heroSlides, type SectionConfigMap } from "@tokophi/sections";
import { Hero } from "@/components/theme/sections/Hero";
import { ProductGrid } from "@/components/theme/sections/ProductGrid";
import { BannerPromo } from "@/components/theme/sections/BannerPromo";
import { Testimoni } from "@/components/theme/sections/Testimoni";
import { ImageText } from "@/components/theme/sections/ImageText";
import { Marquee } from "@/components/theme/sections/Marquee";
import { RichText } from "@/components/theme/sections/RichText";
import { CategoryNav } from "@/components/theme/sections/CategoryNav";
import { Blog } from "@/components/theme/sections/Blog";

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
        slides: {
          type: "array",
          label: "Slide (maks. 5 — bergantian otomatis)",
          max: 5,
          getItemSummary: (slide, i) => slide?.heading || `Slide ${(i ?? 0) + 1}`,
          defaultItemProps: {
            imageUrl: "",
            heading: "Judul Slide",
            subheading: "Satu kalimat singkat tentang koleksi ini.",
            ctaLabel: "Belanja Sekarang",
            ctaHref: "/kategori/dress",
            focal: "center",
          },
          arrayFields: {
            imageUrl: {
              type: "text",
              label: "URL Gambar (mis. /hero/hero-1.webp — kosong = gradasi warna brand)",
            },
            heading: { type: "text", label: "Judul" },
            subheading: { type: "textarea", label: "Sub-judul" },
            ctaLabel: { type: "text", label: "Teks Tombol" },
            ctaHref: { type: "text", label: "Link Tombol" },
            focal: {
              type: "select",
              label: "Fokus Gambar (bagian yang dipertahankan saat dipotong)",
              options: [
                { label: "Tengah", value: "center" },
                { label: "Kiri", value: "left" },
                { label: "Kanan", value: "right" },
              ],
            },
          },
        },
        intervalMs: {
          type: "number",
          label: "Ganti Slide Setiap (milidetik, 0 = tidak berganti)",
          min: 0,
          max: 30000,
        },
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
      // Back-compat: heroes saved before the carousel only carry the flat legacy fields
      // (heading/subheading/imageUrl/ctaLabel/ctaHref) and no `slides`, so the slides array would
      // open EMPTY and their copy would be uneditable. On load, migrate them through the same
      // `heroSlides()` normaliser the renderers use → one slide holding exactly what the storefront
      // already shows. The legacy fields are left untouched in props (nothing is dropped).
      resolveData: (data, { trigger }) => {
        if (trigger !== "load") return data;
        if (data.props.slides && data.props.slides.length > 0) return data;
        return { ...data, props: { ...data.props, slides: heroSlides(data.props) } };
      },
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
    blog: {
      // "Jurnal" — the shopper-facing word. `/blog`'s own H1 says Jurnal; the merchant's editor for
      // the posts is called Blog. The label follows what the storefront shows.
      label: "Jurnal",
      fields: {
        heading: { type: "text", label: "Judul" },
        // A select, not a number: the layout only has sensible columns for 2–4. A free number field
        // invites 7, which is a broken grid the merchant has to discover by publishing.
        limit: {
          type: "select",
          label: "Jumlah tulisan",
          options: [
            { label: "2 tulisan", value: 2 },
            { label: "3 tulisan", value: 3 },
            { label: "4 tulisan", value: 4 },
          ],
        },
        ctaLabel: { type: "text", label: "Teks link ke semua tulisan (kosong = sembunyi)" },
        // NO link field on purpose: the destination is always /blog, which every store has. The
        // free-text hrefs elsewhere in this config are how defaults ended up pointing at
        // /kategori/dress — a handle only the demo store owns. See BlogConfig in @tokophi/sections.
      },
      defaultProps: SECTION_DEFAULTS.blog,
      render: (props) => <Blog {...props} />,
    },
  },
};
