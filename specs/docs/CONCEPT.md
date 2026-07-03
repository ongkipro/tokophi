# Indostore — Concept (mature spec)

> The product concept, fleshed out so the backend (Supabase) is later "just implementation."
> Companion to `../PRD.md`, `SCHEMA.md` (backend-ready tables), `UI_INVENTORY.md` (screen status).
> Phase: **concept + UI/UX first**; the **backend is now being wired** on local PostgreSQL (Drizzle) — super-admin + 12 admin modules read the DB; the rest still mock. (§8 covers why deferring the full backend early was safe.)

---

## 1. Vision
A **Shopify-style commerce platform for the Indonesian market**: one shared, modern-SaaS **admin** running many merchant stores, plus a **per-client Astro storefront** built bespoke per brand. Lightweight, Bahasa Indonesia, opinionated — the polish of Shopify-admin without its bloat.

**Deliberately NOT:**
- ❌ No **Themes** store/editor — storefronts are hand-built Astro sites per client.
- ❌ No **Apps/Plugins** marketplace — the feature set is curated in-core.
- ✅ Tuned to Indonesian sellers: WhatsApp/IG/TikTok-first, COD, QRIS/e-wallets, local couriers, payday cycles, province-level reach.

## 2. Target market & personas
- **Penjual UMKM & D2C** (fashion, F&B, kecantikan, elektronik, rumah tangga) yang jualan di IG/TikTok/WA dan mau "naik kelas" ke toko sendiri.
- **Operator toko** (owner + staf gudang + admin) — butuh alat cepat, ringan, Bahasa Indonesia, jalan di HP Android murah.
- **Kita (platform)** — mengelola banyak toko klien dari satu admin; storefront tiap klien kita bangun manual (1 klien 1 deploy).

## 3. Product principles
1. **Opinionated, curated** — fitur inti matang, bukan marketplace plugin.
2. **Indonesia-first** — istilah, mata uang (IDR, tanpa sen), pembayaran & kurir lokal, provinsi.
3. **Cepat & ringan** — modern SaaS, responsif ke layar kecil, aksesibel (AA), console-clean.
4. **Mock-first → backend-ready** — UI dibangun di atas data-layer seam; skema mock = cerminan tabel DB.
5. **Multi-tenant sejak awal** — semua entitas ber-`store_id`, RLS.

## 4. Surfaces
| Surface | Untuk | Tech | Jumlah |
|---|---|---|---|
| **Admin** | operator toko + platform | Next.js + shadcn/ui (Base UI) | **1 app bersama**, multi-toko |
| **Storefront** | pembeli | Astro + Tailwind | **1 per klien**, tampilan bespoke |

## 5. Feature map (menuju matang)
Legend: ✅ built (UI, mock) · 🟡 partial · ⬜ planned

**Penjualan**
- ✅ Dashboard (KPI, date-range FB-style, chart, live feed, target)
- ✅ Pesanan (list, filter, detail sheet, timeline) · ⬜ Draft/pesanan manual · ⬜ Abandoned checkout · ⬜ Retur/refund
**Produk**
- ✅ Produk (list, editor lengkap, varian toggle, media, harga+margin, inventori, SEO) · 🟡 Varian penuh (per-varian sku/harga/stok) · ⬜ Media banyak-gambar riil
- ✅ Kategori/Koleksi (editor Manual/Otomatis + kondisi) · ✅ Inventori (stepper stok) · ✅ Pembelian/Purchase Order · ⬜ Transfer stok antar-lokasi · ⬜ Pemasok (supplier CRUD)
**Pelanggan**
- ✅ Pelanggan (list, profil sheet, segmen tab) · ✅ Segmen · ✅ Ulasan (moderasi) · ⬜ Loyalitas/poin · ⬜ Grup/tag lanjutan
**Pemasaran**
- ✅ Iklan Meta/Google/TikTok (ringkasan, ROAS, per-saluran) · ✅ Pelacakan/pixel (Pixel/CAPI/GA4/Events API) · ✅ Filter & performa per-provinsi · ⬜ Kampanye email/WhatsApp broadcast · ⬜ Otomasi (welcome, abandoned)
**CRM (follow-up WhatsApp)**
- ✅ Follow-up WA (keranjang/pembayaran/konfirmasi/pasca-beli/repeat/ulasan → kirim via wa.me) · ✅ Pipeline penjualan (kanban leads Baru→Menang) · ✅ Template pesan WA · ⬜ Inbox percakapan · ⬜ Broadcast & otomasi WA
**Diskon**
- ✅ Diskon (kode, %/nominal/ongkir, penggunaan) · ⬜ Diskon otomatis bertingkat · ⬜ Kartu hadiah
**Analitik**
- ✅ Laporan (KPI, tren, kategori, channel, funnel, wilayah, perangkat, ROAS) · ⬜ Laporan kustom & ekspor riil
**Toko Online (konten)**
- ✅ Halaman · ✅ Blog · ✅ Navigasi (menu builder) — semua dimodelkan dari Shopify (screened via CLI)
**Pengaturan**
- ✅ Profil toko · ✅ Pembayaran (Transfer/QRIS/OVO/GoPay/DANA/COD/VA) · ✅ Pengiriman (JNE/J&T/SiCepat/AnterAja/Pos/GoSend/Grab) · ✅ Pajak (PPN 11%) · ✅ Pengguna/peran · ⬜ Domain · ⬜ Notifikasi (email/WA templates) · ⬜ Lokasi/gudang

> UI untuk yang ✅ sudah ada (mock). "Matang" = lengkapi 🟡/⬜ **penting** + sambung backend (M3).

### 5.1 Channel model (penting — biar tidak bingung)
- **Saluran penjualan = HANYA "Toko Online"** (produk dijual lewat storefront). Bukan Instagram/WhatsApp/TikTok Shop. Editor produk & koleksi hanya menampilkan Toko Online.
- **Sumber/atribusi** (dipakai di **Dashboard/Analitik "Sumber Penjualan"**, kolom **Pesanan "Sumber"**, dan **Pemasaran**) = **Meta Ads** (conversion) · **TikTok Ads** · **Google Ads** · **Organic** · **Other** — menjawab "dari mana konversinya".
- WhatsApp/IG/TikTok = kanal **akuisisi/percakapan** (lewat CRM & iklan), **bukan** sales channel.

## 6. Storefront concept (per klien)
Astro + Tailwind, berbagi design tokens. Section: beranda (hero, unggulan, kategori), koleksi, detail produk, keranjang, checkout (mock → real). SEO-first (pola petcue/pixsgo). Baca data toko via read-API/static build. Dibangun manual per brand — **bukan** theme editor.

## 7. Monetization / plans (konsep)
Tier langganan (UI sudah menyiratkan "Paket Bisnis"):
- **Pemula** — 1 toko, fitur inti, transaksi terbatas.
- **Bisnis** — multi-toko, analitik lanjutan, pemasaran/iklan, prioritas support.
- (opsional) **Skala** — API, multi-lokasi, peran lanjutan.
Billing & entitlement = kerjaan backend nanti; disimpan per `store`/`account`.

## 8. Kenapa menunda backend AMAN
- **Seam data-layer** (`admin/lib/data/*`) memisahkan UI dari sumber data. Hari ini baca mock; nanti isi fungsi yang sama panggil Supabase — **signature & props komponen tak berubah**.
- **Mock deterministik** (seeded, anchor `TODAY`) = SSR≡client, demo stabil, dan **bentuknya sengaja mencerminkan tabel DB** (lihat `SCHEMA.md`).
- Maka M3 = **isi query, bukan rombak UI**. Risiko rendah, terkurung.
- Prasyarat agar tetap aman: (a) layar TERUS baca lewat seam (jangan fetch ad-hoc), (b) mock ⇄ `SCHEMA.md` tetap sinkron saat nambah entitas.

## 9. Roadmap ke matang
- **M0–M1 (selesai):** shell + Dashboard + 12 modul + editor produk/koleksi + submenu + pemasaran/analitik + konten. UI matang, mock.
- **M2 (konsep sekarang):** matangkan konsep + skema (dokumen ini), lengkapi 🟡/⬜ prioritas (varian penuh, media riil, draft order), + **1 sample storefront Astro**.
- **M3:** Supabase (Auth + Postgres + Storage + RLS `store_id`) → ganti seam mock→query; form benar-benar menyimpan; upload gambar; rich-text asli.
- **M4:** integrasi pembayaran & kurir riil, provisioning multi-toko, pipeline deploy storefront per klien, billing/plans.

## 10. Guardrails (jangan menyimpang)
- **Pembayaran, COD, & kurir = dikelola PLATFORM (super-admin), bukan merchant.** Merchant "terima matang" — hanya mengaktifkan metode di tokonya, tanpa daftar akun / isi API. Config & kredensial ada di super-admin, berlaku semua toko. (ADR 0004)
- Tanpa Themes, tanpa Apps marketplace.
- Semua entitas ber-`store_id` + RLS.
- Uang selalu IDR; Bahasa Indonesia; aksesibel; console-clean.
- Base UI gotchas dipatuhi (lihat `~/projects/indostore/AGENTS.md`).

*Living doc — perbarui saat konsep bergerak. Skema teknis di `SCHEMA.md`, status layar di `UI_INVENTORY.md`.*
