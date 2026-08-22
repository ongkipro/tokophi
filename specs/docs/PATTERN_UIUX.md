# TokoΦ — UI/UX & Component Architecture Pattern

**Date**: 2026-08-04
**Target**: Merchant Admin (`apps/admin`), Super Admin (`apps/super-admin`), Storefront (`apps/storefront`), Landing Page (`apps/landing`).

---

## 1. Global UI Architecture & Tech Stack

TokoΦ adopts a monorepo structure where UI primitives and design tokens are centralized to ensure visual consistency across all 4 surfaces.

- **CSS Framework**: **Tailwind CSS v4** (menggunakan `@import "tailwindcss"` dan integrasi `@theme inline`).
- **Color Format**: **OKLCH** (digunakan secara eksplisit di `globals.css` untuk akurasi dan vibransi warna yang modern, memastikan *light* dan *dark mode* memiliki kontras yang identik).
- **Component Library**: **shadcn/ui** yang berjalan di atas **Base UI** (`@base-ui/react`), BUKAN Radix Primitives. Ini memengaruhi pola penulisan *Trigger* (menggunakan prop `render` alih-alih `asChild`).
- **Icons**: **Lucide React** & **Lucide Astro** (Stroke-based, dirender selaras dengan `currentColor` dan *brand scale*, tidak menggunakan sistem font-icon/emoji).
- **Animations**: `tw-animate-css` terintegrasi.

---

## 2. Design Tokens & Theming (`packages/ui/src/styles/globals.css`)

Semua variabel tema dan warna dideklarasikan sebagai variabel CSS berbasis OKLCH.

- **Brand Accent**: Indigo/Violet (`--primary: oklch(0.515 0.23 277)`).
- **Radius**: Menggunakan variabel hierarkis `--radius` yang diskala secara matematis (`--radius-sm`, `--radius-md`, `--radius-lg` hingga `--radius-4xl`).
- **Dark Mode**: Didukung secara native dengan `class="dark"`. State disimpan via `MutationObserver` pada *document element* untuk menghindari *cascading renders* (bukan via `useEffect` yang berat).
- **Background & Surface**: Menggunakan `oklch(1 0 0)` (Pure White) untuk *light mode*, dan abu-abu gelap `oklch(0.145 0 0)` untuk *dark mode*.

---

## 3. Surface-Specific Patterns

### A. Merchant Admin (`apps/admin`) & Super Admin (`apps/super-admin`)
Pendekatan: **Console-clean, Data-dense, Dashboard SaaS Modern**.

- **Layout Structure**: 
  - Dibungkus oleh `<AdminChrome>` yang menangani *full-bleed routes* (seperti Store Builder) vs *standard routes*.
  - *Standard routes* memiliki `<Sidebar>` (sticky) dan `<Topbar>` (sticky dengan *backdrop-blur-md*).
  - Konten utama berada dalam `<main className="flex-1 bg-muted/30 p-4 sm:p-6">`.
- **Top Navigation (`Topbar`)**:
  - Global Search (Shortcut `⌘K`) di tengah.
  - *Saldo Chip* yang tersembunyi elegan (hanya angka, klik untuk rincian).
  - Theme Toggle, Notifikasi, dan Avatar Profile (Dropdown Menu) diletakkan rata kanan.
- **Data Display (`DashboardClient`)**:
  - **Cards**: Menggunakan *Base UI Card* dengan proporsi *gap* konsisten (`space-y-5`).
  - **Charts**: Recharts (di-wrap dengan komponen `<SalesChart>`, `<ChannelChart>`).
  - **KPIs**: Menghindari *false-promises*. Data kosong akan menampilkan status "—" atau status abu-abu (*graceful degradation*).
  - **Formatting**: Terpusat menggunakan `@tokophi/lib/format` (`IDR()`, `num()`, `pct()`). Menggunakan *tabular-nums* agar angka sejajar secara vertikal.

### B. Storefront (`apps/storefront`) & Landing (`apps/landing`)
Pendekatan: **Aesthetic E-commerce, Conversion-optimized, Astro SSR**.

- **Structure**: Halaman didorong oleh SSR Astro. *Page structure* diatur melalui `SectionRenderer` jika menggunakan *Store Builder*, atau *fallback* hardcode (seperti `<Hero>`, `<TrustStrip>`).
- **Micro-interactions**: 
  - *Hover effect* pada `<ProductCard>` dan kategori menggunakan Tailwind (`hover:-translate-y-0.5`, `hover:shadow-xl`, `hover:scale-110`).
  - *Focus states* jelas (`focus-visible:ring-brand-400`).
- **Content Hierarchy**: 
  - `<Hero>` -> `<Trust Strip>` (Alasan membeli) -> `<Koleksi>` -> `<Cerita Kami>` -> `<Bestsellers>` -> `<Closing CTA>`.
  - Tombol aksi utama berbentuk kapsul (`rounded-full`) dengan efek bayangan dan transisi warna halus.

---

## 4. Component Rules & Gotchas

1. **Trigger Base UI**: `DropdownMenuTrigger`, `SheetTrigger`, dll HARUS menggunakan prop `render={<Button />}`. Jangan menggunakan `asChild`.
2. **Buttons sebagai Link**: Gunakan `nativeButton={false}` lalu isi `render={<Link href="..." />}` untuk menghindari *console errors*.
3. **Select vs DropdownMenu**: Hindari komponen `<Select>` bawaan Base UI karena API-nya berbeda; gunakan `<DropdownMenu>` atau `<Tabs>` untuk *pickers/filters*.
4. **Icons**: Selalu definisikan `size`, `stroke-width` jika perlu, dan sebisa mungkin gunakan *opacity* (via text-muted-foreground) untuk hierarki visual, bukan sekadar memperkecil ukuran.
