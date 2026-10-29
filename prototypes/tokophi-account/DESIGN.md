# TokoPhi Design System & Component Anatomy — Buyer Portal (`Akun Pembeli`)

Dokumen ini adalah **single source of truth** untuk skema warna, token desain, anatomi komponen berbasis **shadcn/ui** + `@base-ui/react`, serta audit pembersihan *AI slop* pada Akun Pembeli TokoPhi. Sistem ini bercermin 1:1 terhadap Seller Dashboard (`apps/admin/app/globals.css`) dan paket pustaka bersama (`packages/ui/src/components/ui/`).

---

## 1. Skema Warna & Token Desain (Color Schema)

TokoPhi mengadopsi ruang warna modern **OKLCH** untuk menjaga persepsi luminansi dan kontras yang akurat antara mode terang (Light) dan gelap (Dark).

### A. TokoPhi Signature Brand Token (Indigo Accent)
Warna aksen utama TokoPhi menggunakan **Indigo OKLCH Hue 277**:
- **Light Mode:**
  - `--primary`: `oklch(0.515 0.23 277)` (Indigo TokoPhi)
  - `--primary-foreground`: `oklch(0.985 0 0)` (Putih kontras tinggi)
  - `--primary-10`: `color-mix(in oklab, var(--primary) 10%, transparent)` (Surface hover / badge background)
  - `--ring`: `oklch(0.515 0.23 277)` (Focus ring)
- **Dark Mode:**
  - `--primary`: `oklch(0.62 0.20 277)` (Indigo disesuaikan untuk kontras latar gelap)
  - `--primary-foreground`: `oklch(0.985 0 0)`
  - `--ring`: `oklch(0.62 0.20 277)`

### B. Surface & Canvas Neutral Tokens
| Token | Light Mode (OKLCH / Hex) | Dark Mode (OKLCH / Hex) | Fungsi Anatomi |
|---|---|---|---|
| `--background` | `oklch(1 0 0)` (#ffffff) | `oklch(0.145 0 0)` (#18181b) | Kanvas dasar aplikasi |
| `--foreground` | `oklch(0.145 0 0)` (#18181b) | `oklch(0.985 0 0)` (#fafafa) | Teks utama / heading |
| `--card` | `oklch(1 0 0)` (#ffffff) | `oklch(0.205 0 0)` (#27272a) | Latar kartu komponen |
| `--card-foreground`| `oklch(0.145 0 0)` (#18181b) | `oklch(0.985 0 0)` (#fafafa) | Teks di dalam kartu |
| `--secondary` | `oklch(0.97 0 0)` (#f4f4f5) | `oklch(0.269 0 0)` (#3f3f46) | Tombol sekunder / badge netral |
| `--secondary-foreground` | `oklch(0.205 0 0)` (#27272a) | `oklch(0.985 0 0)` (#fafafa) | Teks tombol sekunder |
| `--muted` | `oklch(0.97 0 0)` (#f4f4f5) | `oklch(0.269 0 0)` (#3f3f46) | Background tab list / disabled |
| `--muted-foreground` | `oklch(0.556 0 0)` (#71717a) | `oklch(0.708 0 0)` (#a1a1aa) | Teks sekunder, label, helper |
| `--border` | `oklch(0.922 0 0)` (#e4e4e7) | `oklch(1 0 0 / 10%)` | Garis batas subtil & separator |
| `--input` | `oklch(0.922 0 0)` (#e4e4e7) | `oklch(1 0 0 / 15%)` | Garis batas form input |

### C. Semantic Status Tokens (Commerce Specific)
- **Destructive / Error:** `oklch(0.577 0.245 27.325)` (Light) / `oklch(0.704 0.191 22.216)` (Dark).
- **Success / Selesai / Terhubung:** `#16a34a` (Light) / `#34d399` (Dark), background `color-mix(in oklab, #10b981 12%, var(--card))`.
- **Warning / Menunggu Pembayaran:** `#b45309` (Light) / `#fbbf24` (Dark), background `color-mix(in oklab, #f59e0b 12%, var(--card))`.
- **Info / Sedang Dikirim:** `var(--primary)` / `#0284c7`, background `color-mix(in oklab, var(--primary) 12%, var(--card))`.

---

## 2. Tipografi & Skala Geometri

- **Font Family:** `Geist, Arial, sans-serif` (Didukung Geist Latin WOFF2 preload lokal).
- **Tabular Figures:** `font-variant-numeric: tabular-nums` wajib pada semua nominal uang (IDR), nomor resi, nomor pesanan, dan tanggal agar angka sejajar rapi secara vertikal.
- **Radius Tokens:**
  - Base `--radius`: `0.625rem` (10px)
  - Small `--radius-sm`: `6px` (Badge, chips)
  - Medium `--radius-md`: `8px` (Button, input, dropdown)
  - Large `--radius-lg`: `10px` (Card, section, dialog)
  - Pill / Full: `9999px` (Badge count, tab pill)
- **Layout Geometri:**
  - Sidebar Width: `256px` (`w-64`) tetap.
  - Topbar Height: `64px` (`h-16`) dengan backdrop blur (`backdrop-filter: blur(12px)`).
  - Shell Container: `max-width: 1200px; margin: 0 auto;` terpusat (*centered*) di desktop tanpa border vertikal luar (*frameless*).
  - Mobile Bottom Nav: `64px` + `env(safe-area-inset-bottom)`.

---

## 3. Anatomi Komponen (shadcn/ui Implementation)

### A. Button (`packages/ui/src/components/ui/button.tsx`)
```
[Button Anatomy]
 ├── Root: <button data-slot="button" class="button [variant] [size]">
 ├── Typography: 14px, font-medium, whitespace-nowrap
 ├── Focus: outline-none, focus-visible:ring-3, ring-ring/50
 └── Variants:
      ├── default: bg-primary text-primary-foreground hover:bg-primary/80
      ├── outline: border border-border bg-background hover:bg-muted text-foreground
      ├── secondary: bg-secondary text-secondary-foreground hover:bg-secondary/80
      ├── ghost: bg-transparent hover:bg-muted text-foreground
      └── destructive: bg-destructive/10 text-destructive border-transparent hover:bg-destructive/20
```

### B. Card (`packages/ui/src/components/ui/card.tsx`)
```
[Card Anatomy]
 ├── Root: <div data-slot="card" class="section-card">
 │    ├── Border: 1px solid var(--border)
 │    ├── Background: var(--card)
 │    ├── Shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05) (shadow-xs)
 │    └── Radius: var(--radius-lg) (10px)
 ├── Card Header: <div data-slot="card-header" class="section-heading">
 ├── Card Title: <h2 data-slot="card-title"> (Semantic <h2>, BUKAN <div>!)
 ├── Card Description: <p data-slot="card-description" class="lead">
 └── Card Content: <div data-slot="card-content">
```
*Aturan Invariant TokoPhi:* Tidak boleh ada card di dalam card (*nested box-in-a-box*). Setiap card langsung duduk di atas kanvas latar.

### C. Badge (`packages/ui/src/components/ui/badge.tsx`)
```
[Badge Anatomy]
 ├── Root: <span data-slot="badge" class="badge [variant]">
 ├── Shape: rounded-full (9999px), h-5, px-2 py-0.5
 ├── Typography: 11px, font-medium, tabular-nums
 └── States:
      ├── shipped: bg-info/12 text-info border-info/25
      ├── warning: bg-warning/12 text-warning border-warning/25
      ├── done: bg-success/12 text-success border-success/25
      └── neutral: bg-secondary text-muted-foreground border-border
```

### D. Input & Input Group (`packages/ui/src/components/ui/input.tsx`)
```
[Input Group Anatomy]
 ├── Container: <div class="phone-input-group" style="position: relative;">
 ├── Prefix: <span class="phone-prefix">+62</span> (position: absolute; left: 14px; top: 50%; pointer-events: none;)
 └── Input: <input data-slot="input" class="login-input phone-input">
      ├── Height: 44px (touch target minimum mobile)
      ├── Padding: padding-left: 48px !important (menjamin 0 collision dengan +62)
      ├── Focus: border-primary, box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--ring)
      └── Caret: caret-color: var(--primary)
```

### E. Tabs (`packages/ui/src/components/ui/tabs.tsx`)
```
[Tabs Anatomy]
 ├── Tabs List: <div data-slot="tabs-list" class="filter-bar"> (bg-muted, p-[3px], rounded-lg)
 └── Tabs Trigger: <button data-slot="tabs-trigger" class="filter [data-active]">
      ├── Inactive: text-muted-foreground, bg-transparent
      └── Active: bg-background, text-foreground, shadow-xs, font-medium
```

---

## 4. Rekap Perombakan AI Slop (What was Overhauled)

Berikut adalah daftar elemen klise AI/template generik yang telah dibersihkan secara tuntas:

1. **Banned Eyebrow Kickers:**
   - *Sebelum:* Label teks kapital kecil (`BERANDA`, `PESANAN LINTAS TOKO`, `ALAMAT`, `AKUN PEMBELI`) di atas H1.
   - *Rombakan:* Dihapus 100%. H1 berbicara sendiri dengan bobot tipografi yang tegas. Konteks toko dipindahkan ke baris metadata alami.
2. **Banned Unicode Emoji in Headings:**
   - *Sebelum:* `Halo, Sari Andini 👋` (Emoji melambai khas prompt AI).
   - *Rombakan:* `Halo, Sari Andini` (Dihapus sesuai standar `craft-floor.md`).
3. **Eliminasi Box-in-a-Box (Nested Borders):**
   - *Sebelum:* Kartu pesanan dibungkus oleh section card lagi, menghasilkan garis ganda kotak di dalam kotak.
   - *Rombakan:* Kartu pesanan langsung duduk di atas kanvas dengan elevation subtil, tanpa wrapper border ganda.
4. **Harsh 4px Accent Borders:**
   - *Sebelum:* Garis tebal 4px di sisi kiri kartu alert (`border-left: 4px solid ...`).
   - *Rombakan:* Diganti dengan border 1px yang lembut bernuansa warna selaras (`color-mix`) dan badge status kapsul yang elegan.
5. **Blank Placeholder Image:**
   - *Sebelum:* Produk tanpa foto hanya berupa kotak abu-abu polos seperti elemen patah.
   - *Rombakan:* Diganti dengan SVG icon produk gaya Lucide yang proporsional.
6. **Mobile Grid Fatigue:**
   - *Sebelum:* 4 kartu metrik ditumpuk memanjang ke bawah menghabiskan layar ponsel.
   - *Rombakan:* Dikonversi menjadi grid 2x2 responsif yang rapi.
