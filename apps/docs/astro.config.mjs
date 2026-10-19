import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Panduan TokoΦ — the Seller help center, its own static site (Task 8.37, specs/docs/PANDUAN_SPEC.md).
// Static output on purpose: no DB, no session, nothing that can break when the product is down.
export default defineConfig({
  site: "https://panduan.tokophi.com",
  integrations: [
    starlight({
      title: "Panduan TokoΦ",
      titleDelimiter: "-",
      routeMiddleware: "./src/routeData.ts",
      description: "Panduan lengkap Dashboard Seller TokoΦ: buka toko, atur pengiriman dan COD, tambah produk, proses pesanan, dan tarik saldo.",
      favicon: "/favicon.svg",
      defaultLocale: "root",
      locales: { root: { label: "Bahasa Indonesia", lang: "id" } },
      customCss: ["./src/styles/custom.css", "./src/styles/search.css"],
      components: {
        Header: "./src/components/SiteHeader.astro",
        Hero: "./src/components/HomeHero.astro",
        Sidebar: "./src/components/SidebarWithSearch.astro",
        Footer: "./src/components/SiteFooter.astro",
        ThemeSelect: "./src/components/ThemeToggle.astro",
        PageTitle: "./src/components/PageTitleWithCrumb.astro",
        MobileMenuFooter: "./src/components/MobileMenuFooter.astro",
      },
      lastUpdated: false,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        { label: "Mulai di sini", items: ["mulai", "mulai/daftar-toko", "mulai/amankan-akun", "mulai/profil-dan-alamat", "mulai/pengiriman-dan-cod", "mulai/tambah-produk", "mulai/tampilan-toko", "mulai/pesanan-pertama"] },
        { label: "Produk", collapsed: true, items: ["produk", "produk/varian", "produk/foto", "produk/kategori", "produk/inventori", "produk/pembelian"] },
        { label: "Tampilan toko", collapsed: true, items: ["tampilan", "tampilan/susun-halaman", "tampilan/menu-navigasi", "tampilan/halaman-statis", "tampilan/artikel-blog", "tampilan/domain-sendiri"] },
        { label: "Pesanan", collapsed: true, items: ["pesanan", "pesanan/tab-dan-status", "pesanan/booking-pengiriman", "pesanan/cetak-label", "pesanan/retur", "pesanan/pesanan-cod"] },
        { label: "Uang", collapsed: true, items: ["uang", "uang/saldo-dan-penarikan", "uang/penghasilan", "uang/langganan-dan-faktur", "uang/biaya-pembeli"] },
        { label: "Tim", collapsed: true, items: ["tim", "tim/undang-anggota", "tim/ubah-peran-dan-hapus", "tim/ganti-toko"] },
        { label: "Referensi", collapsed: true, items: ["referensi/kamus", "referensi/biaya", "referensi/status-pesanan", "referensi/peran-tim", "referensi/angka-penting"] },
        { label: "Bantuan", items: ["faq"] },
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#4338ca" } },
        { tag: "meta", attrs: { name: "author", content: "TokoΦ" } },
        { tag: "meta", attrs: { name: "publisher", content: "TokoΦ" } },
      ],
    }),
  ],
});
