import type { Config, CustomField } from "@measured/puck";
import {
  SECTION_DEFAULTS,
  SECTION_ICON_KEYS,
  SECTION_ICON_LABELS,
  SECTION_LABELS,
  SECTIONS_BY_TEMPLATE_TYPE,
  heroSlides,
  type SectionConfigMap,
  type SectionType,
} from "@tokophi/sections";
import { ImagePickerField } from "@/components/theme/image-picker";
import { LinkPickerField } from "@/components/theme/link-picker";

// Shopify-style image + link fields (upload/library/URL/product/category, and product/category/page/URL)
// in place of the bare text boxes. Generic in the value type so each infers `string` or `string | undefined`
// from the field slot it fills (Puck's CustomField is invariant); the stored VALUE stays a plain string,
// so existing templates and the storefront are untouched.
const imageField = <V extends string | undefined>(label: string): CustomField<V> => ({
  type: "custom",
  label,
  render: ({ value, onChange, field, readOnly }) => (
    <ImagePickerField value={value ?? ""} onChange={onChange as (v: string) => void} field={field} readOnly={readOnly} />
  ),
});

const linkField = <V extends string | undefined>(label: string): CustomField<V> => ({
  type: "custom",
  label,
  render: ({ value, onChange, field, readOnly }) => (
    <LinkPickerField value={value ?? ""} onChange={onChange as (v: string) => void} field={field} readOnly={readOnly} />
  ),
});
import { Hero } from "@/components/theme/sections/Hero";
import { ProductListing } from "@/components/theme/sections/ProductListing";
import { ProductGrid } from "@/components/theme/sections/ProductGrid";
import { Multicolumn } from "@/components/theme/sections/Multicolumn";
import { Faq } from "@/components/theme/sections/Faq";
import { BannerPromo } from "@/components/theme/sections/BannerPromo";
import { Testimoni } from "@/components/theme/sections/Testimoni";
import { ImageText } from "@/components/theme/sections/ImageText";
import { Marquee } from "@/components/theme/sections/Marquee";
import { RichText } from "@/components/theme/sections/RichText";
import { CategoryNav } from "@/components/theme/sections/CategoryNav";
import { CollectionBento } from "@/components/theme/sections/CollectionBento";
import { Blog } from "@/components/theme/sections/Blog";
import { Lookbook } from "@/components/theme/sections/Lookbook";

// ADR 0009 — the Puck `Config` is the admin-side half of the section registry
// (@tokophi/sections/registry.ts is the shared shape; apps/storefront's Astro components are
// the other half). Puck's component keys must match `SectionType` from the registry so
// `page_templates.sections[].type` round-trips cleanly between the builder and the renderer.
// Derived from the shared allow-list so the builder can never offer an icon the renderers do not
// have. Adding one is a single edit in @tokophi/sections.
const ICON_OPTIONS = SECTION_ICON_KEYS.map((k) => ({ label: SECTION_ICON_LABELS[k], value: k }));

const fullConfig: Config<SectionConfigMap> = {
  components: {
    "product-listing": {
      label: SECTION_LABELS["product-listing"],
      fields: {
        heading: { type: "text", label: "Judul (kosong = tanpa judul)" },
      },
      defaultProps: SECTION_DEFAULTS["product-listing"],
      render: (props) => <ProductListing {...props} />,
      // ONE per template. Two instances emit two `id="listing-controls"` forms and two
      // `id="sort-select"` selects, and ProductListing's inline script binds by `getElementById` —
      // so the SECOND listing's sort dropdown is simply dead, both page off the same `?page=`, and
      // the document carries duplicate ids. Same extension point Grid Produk uses for its own cap.
      resolvePermissions: (_data, { appState }) => ({
        insert: appState.data.content.filter((i) => i.type === "product-listing").length < 1,
      }),
    },
    multicolumn: {
      label: SECTION_LABELS.multicolumn,
      fields: {
        eyebrow: { type: "text", label: "Kicker (kosong = sembunyi)" },
        heading: { type: "text", label: "Judul" },
        columns: {
          type: "select",
          label: "Kolom",
          options: [
            { label: "2", value: 2 },
            { label: "3", value: 3 },
            { label: "4", value: 4 },
          ],
        },
        items: {
          type: "array",
          label: "Kolom (maks. 8)",
          max: 8,
          getItemSummary: (item, i) => item?.title || `Kolom ${(i ?? 0) + 1}`,
          defaultItemProps: { icon: "truck", title: "Judul singkat", text: "Satu kalimat penjelas." },
          arrayFields: {
            // A SELECT over the shared allow-list, never a free-text icon name: a typo would render
            // a dot on the storefront with nothing telling the merchant why.
            icon: { type: "select", label: "Ikon", options: ICON_OPTIONS },
            title: { type: "text", label: "Judul" },
            text: { type: "textarea", label: "Keterangan" },
          },
        },
      },
      defaultProps: SECTION_DEFAULTS.multicolumn,
      render: (props) => <Multicolumn {...props} />,
    },
    faq: {
      label: SECTION_LABELS.faq,
      fields: {
        eyebrow: { type: "text", label: "Kicker (kosong = sembunyi)" },
        heading: { type: "text", label: "Judul" },
        items: {
          type: "array",
          label: "Pertanyaan (maks. 12)",
          max: 12,
          getItemSummary: (item, i) => item?.question || `Pertanyaan ${(i ?? 0) + 1}`,
          defaultItemProps: {
            question: "Berapa lama pengiriman?",
            answer: "Tulis jawabannya di sini.",
          },
          arrayFields: {
            question: { type: "text", label: "Pertanyaan" },
            answer: { type: "textarea", label: "Jawaban" },
          },
        },
      },
      defaultProps: SECTION_DEFAULTS.faq,
      render: (props) => <Faq {...props} />,
    },
    hero: {
      label: SECTION_LABELS.hero,
      fields: {
        badge: { type: "text", label: "Label Badge (kosong = sembunyi)" },
        slides: {
          type: "array",
          label: "Slide (maks. 5 — bergantian otomatis)",
          max: 5,
          getItemSummary: (slide, i) => slide?.heading || `Slide ${(i ?? 0) + 1}`,
          defaultItemProps: {
            imageUrl: "",
            mobileImageUrl: "",
            heading: "Judul Slide",
            subheading: "Satu kalimat singkat tentang koleksi ini.",
            ctaLabel: "Belanja Sekarang",
            // `/kategori/semua` — a VIRTUAL collection every store always has. This said
            // `/kategori/dress`, a handle only the demo owns: `SECTION_DEFAULTS.hero` was cleaned for
            // exactly that reason (25-line comment in the registry) and this array's own
            // `defaultItemProps` was missed, so every slide a merchant ADDED still 404'd.
            ctaHref: "/kategori/semua",
            focal: "center",
          },
          arrayFields: {
            imageUrl: imageField("Gambar Slide — Desktop (kosong = gradasi warna brand)"),
            mobileImageUrl: imageField("Gambar Mobile (opsional — kosong = pakai gambar desktop)"),
            heading: { type: "text", label: "Judul" },
            subheading: { type: "textarea", label: "Sub-judul" },
            ctaLabel: { type: "text", label: "Teks Tombol" },
            ctaHref: linkField("Link Tombol"),
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
        // The trust strip is rendered by BOTH halves (Hero.astro + the editor preview) and the demo
        // ships four badges — so a merchant could see them on their own canvas and had no field to
        // change or remove them. Same icon allow-list as Kolom Ikon; a badge is a PROMISE, so the
        // default stays empty rather than seeding "Gratis Ongkir" onto a shop that does not offer it.
        features: {
          type: "array",
          label: "Badge Kepercayaan (kosong = tanpa strip)",
          max: 4,
          getItemSummary: (f, i) => f?.title || `Badge ${(i ?? 0) + 1}`,
          defaultItemProps: { icon: "truck", title: "Judul singkat", text: "Satu kalimat penjelas." },
          arrayFields: {
            icon: { type: "select", label: "Ikon", options: ICON_OPTIONS },
            title: { type: "text", label: "Judul" },
            text: { type: "text", label: "Keterangan" },
          },
        },
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
        imageRatio: {
          type: "select",
          label: "Rasio Gambar",
          options: [
            { label: "Potret 3:4 (pakaian)", value: "3:4" },
            { label: "Potret 4:5", value: "4:5" },
            { label: "Kotak 1:1", value: "1:1" },
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
        imageUrl: imageField("Gambar"),
        href: linkField("Link"),
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
        imageUrl: imageField("Gambar"),
        imageSide: {
          type: "select",
          label: "Posisi Gambar",
          options: [
            { label: "Kiri", value: "left" },
            { label: "Kanan", value: "right" },
          ],
        },
        ctaLabel: { type: "text", label: "Teks Tombol (kosong = sembunyi)" },
        ctaHref: linkField("Link Tombol"),
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
        eyebrow: { type: "text", label: "Label Kecil (kosong = sembunyi)" },
        heading: { type: "text", label: "Judul" },
        body: { type: "textarea", label: "Isi Teks" },
        ctaLabel: { type: "text", label: "Teks Tombol (kosong = sembunyi)" },
        ctaHref: linkField("Link Tombol"),
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
            imageUrl: imageField("Gambar"),
            href: linkField("Link"),
          },
        },
      },
      defaultProps: SECTION_DEFAULTS["category-nav"],
      render: (props) => <CategoryNav {...props} />,
    },
    "collection-bento": {
      label: "Bento Koleksi",
      fields: {
        heading: { type: "text", label: "Judul" },
      },
      defaultProps: SECTION_DEFAULTS["collection-bento"],
      render: (props) => <CollectionBento {...props} />,
    },
    lookbook: {
      label: "Lookbook",
      fields: {
        heading: { type: "text", label: "Judul" },
        description: { type: "text", label: "Deskripsi (kosong = sembunyi)" },
        imageUrl: imageField("Gambar"),
      },
      defaultProps: SECTION_DEFAULTS.lookbook,
      render: (props) => <Lookbook {...props} />,
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

// ── THE PALETTE IS PER PAGE TYPE ───────────────────────────────────────────────────────────────
//
// `page_templates.type` has had three values since ADR 0009 (`homepage` / `category` / `product`)
// and this config was a single static object, so the builder offered the SAME sections to all
// three — a Hero (with its own `<h1>`) on a product page that already has the product name as its
// `<h1>`, a Navigasi Kategori under a buy box, a Daftar Produk on a PDP. The registry owns which
// sections belong where (SECTIONS_BY_TEMPLATE_TYPE); this just narrows Puck's component list to it.
//
// Narrowing the PALETTE, never the RENDERER: a template saved earlier that still holds a section no
// longer offered for its type keeps rendering (the storefront's SectionRenderer switches on every
// type regardless). Dropping it from the sidebar stops merchants adding more; it does not silently
// delete work someone already published.
export type TemplateType = keyof typeof SECTIONS_BY_TEMPLATE_TYPE;

export function puckConfigFor(type: TemplateType): Config<SectionConfigMap> {
  const allowed = new Set<SectionType>(SECTIONS_BY_TEMPLATE_TYPE[type]);
  const components = Object.fromEntries(
    // Object.entries loses the key union, hence the cast — the Set is built from SectionType so the
    // filter itself is sound.
    Object.entries(fullConfig.components).filter(([k]) => allowed.has(k as SectionType)),
  ) as Config<SectionConfigMap>["components"];
  return { ...fullConfig, components };
}

/**
 * @deprecated Use `puckConfigFor(type)` — a builder that does not know which page it is editing
 * offers sections that page cannot use. Kept only so nothing breaks mid-refactor.
 */
export const puckConfig = fullConfig;
