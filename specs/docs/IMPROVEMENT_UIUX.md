# TokoΦ — UI/UX Improvement Suggestions

**Date**: 2026-08-04
**Goal**: Elevate UI/UX into a Premium, Dynamic, and "Wow" Experience without touching the backend system.

---

## 1. Aesthetic Enhancements (Premium Feel)

### A. Glassmorphism & Translucency
- **Topbar & Navigation**: Saat ini Topbar admin memiliki `bg-background/80 backdrop-blur-md`. Untuk kesan lebih premium, turunkan opasitas menjadi `bg-background/60` dan tambahkan `border-b border-border/50` serta sedikit saturasi blurnya (`backdrop-saturate-150`) agar konten di belakangnya (saat di-scroll) terlihat lebih estetik layaknya interface macOS/iOS modern.
- **Card Overlays**: Pada `<ProductCard>` di Storefront, gunakan _glass effect_ pada area nama/harga saat di-hover, atau di atas gradient shadow.

### B. Soft Depth & Layering (Shadows)
- Hindari _box-shadow_ hitam standar (`rgba(0,0,0,0.1)`). 
- **Admin Cards**: Ubah ke _tinted shadows_ yang mengambil sedikit aksen dari warna brand utama. (Contoh: `shadow-lg shadow-primary/5`).
- **Storefront Buttons**: Tambahkan _glow effect_ (cahaya berpendar) saat _hover_ (`hover:shadow-brand-500/25`), bukan sekadar bayangan drop biasa.

### C. Refined Color Usage (Oklch Gradients)
- Ganti _solid accent color_ sesekali dengan _subtle gradients_.
- **Dashboard Progress Bars / KPIs**: Gunakan gradasi OKLCH dari `--primary` ke warna analog (misalnya ungu muda ke indigo) untuk mengisi _progress bar_ pesanan dan indikator target.

---

## 2. Dynamic Interactions & Micro-animations

### A. Staggered Entries (Admin & Storefront)
- Integrasikan `tw-animate-css` secara agresif tapi halus.
- Saat `<DashboardClient>` atau list produk (`/pesanan`, `/produk`) di-*mount*, elemen-elemennya tidak boleh muncul bersamaan. Gunakan _stagger_ (contoh: `animate-in fade-in slide-in-from-bottom-2 duration-500 delay-[50ms*i]`) sehingga tabel atau kartu KPI masuk secara beruntun (*cascading*).

### B. Interactive Feedback
- **Buttons**: Setiap klik tombol aksi utama (Simpan, Ekspor) harus memiliki skala tekan (*active state*): `active:scale-95 transition-transform`.
- **Sidebar (Admin)**: Saat kursor melakukan _hover_ pada _NavItem_, _highlight background_-nya jangan muncul secara instan, tapi berikan durasi `duration-200 ease-out`. Item aktif harus memiliki penanda vertikal halus (contoh: border kiri 2px warna `--primary`).

### C. Skeleton & Loading States
- Saat _route transition_, transisinya terasa kaku jika hanya me-render `skeleton.tsx` biasa. Tambahkan animasi `shimmer` dengan _gradient_ yang _fluid_, atau gunakan *skeleton* berbasis teks berdenyut.

---

## 3. Layout & Typography Refinements

### A. Breathing Room (Whitespace)
- **Admin Dashboard**: Jarak antar _Card_ (`gap-4` atau `space-y-5`) sudah cukup baik, tapi perhatikan *padding* internal komponen dalam `<CardContent>`. Pada tabel yang padat informasi, longgarkan `line-height` dan tambahkan ruang kosong di sel agar data terlihat rileks.
- **Storefront**: Pertimbangkan memperlebar `<section>` pada _desktop view_ dengan menambahkan batas _max-width_ yang lebih adaptif, serta meningkatkan ukuran _font heading_ 10-15% agar lebih dominan dan _editorial-style_.

### B. Modern Typography
- Pastikan semua _metric numbers_ (contoh: angka pendapatan, saldo) menggunakan `font-variant-numeric: tabular-nums` (Tailwind: `tabular-nums`) dan `tracking-tight` agar terasa rapi dan tegas.
- Judul bagian pada _Storefront_ (`Koleksi`, `Paling Dicari`) bisa memanfaatkan *letter-spacing* yang sedikit lebih negatif (`tracking-tight`) untuk _font-display_ guna mendapatkan *vibe* premium _magazine/fashion_.

---

## 4. Eksekusi Teknis Berikutnya (Next Steps)
Jika pola ini disetujui, kita bisa langsung memperbarui:
1. `packages/ui/src/styles/globals.css` untuk mendaftarkan utilitas animasi dan bayangan baru.
2. Komponen `Card`, `Button`, `Sidebar`, dan `Topbar` di `apps/admin/components` & `packages/ui/src/components/ui`.
3. Komponen `<ProductCard>` dan `<Hero>` di `apps/storefront/src/components`.
