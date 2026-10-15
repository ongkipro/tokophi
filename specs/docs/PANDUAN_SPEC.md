# TokoΦ — Panduan Seller (merchant help center) spec

> Task 8.37 in root [`TASKS.md`](../../TASKS.md). Companions: [`PAGE_MAP.md`](PAGE_MAP.md) (every
> Seller route the articles describe), ADR 0004 (provider brands stay hidden).
> Status: **phase 1 built 2026-10-12 as its own app, `apps/docs`** (Astro 7 + Starlight 0.42): the
> 7-step tutorial, a glossary, four reference pages and an FAQ, with search and real screenshots.
> Not deployed; the hostname is an owner decision (§9).
> **Revision 2026-10-12 (owner):** the first draft put this at `tokophi.com/panduan` inside the
> landing. The owner reversed that the same day — *"di luar pages landingpage tokophi, namun halaman
> doc sendiri lengkap … ui ux juga tidak ikut pages tokophi"* — so it is a separate site with its own
> UI, and decisions D1/D3/D7 and §6 below are rewritten accordingly.

---

## 1. Problem

Every document in this repo is written for people who build TokoΦ (`GUIDE.md`, `SYSTEM_GUIDE.md`,
`AGENTS.md`). The Seller who runs a store has nothing to read: `/bantuan` in the Seller panel is a
support-ticket inbox, not help content. So every "how do I…" question becomes a ticket, and things
that look broken but are by design (a new store is read-only until reviewed, a resi appears minutes
after booking, the product "Kategori" dropdown does not put a product on a category page) reach the
owner as bug reports.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Its own app, `apps/docs` (`@tokophi/docs`), its own hostname** (proposed `panduan.tokophi.com`; owner to confirm before deploy). | Owner ruling 2026-10-12 (revision note above). Static output, no DB, no session — it must stay readable when the product is down. Independent of the landing's redesign and release cadence. |
| D2 | **Audience = the Seller (store owner and their team).** Shoppers are out of scope. | Shopper questions belong to each store (its own Kontak/Halaman). |
| D3 | **Astro Starlight on Astro 7, isolated to `apps/docs`.** Content = MDX/Markdown in Starlight's `docs` collection (`apps/docs/src/content/docs/`), schema extended with `routes` and `verified`. | A professional docs UI (sidebar, page TOC, prev/next, search, dark mode, a11y, mobile) is Starlight's job — building it by hand is the expensive option. Starlight 0.42 needs Astro 7; the monorepo is on Astro 5.18, and upgrading the storefront (live money path) and the landing (mid-redesign) two majors for a docs site is out of scope. npm workspaces nest Astro 7 under `apps/docs/node_modules`; root stays 5.18.2 (measured). Cost: ~3,300 extra lockfile lines. A repo-wide Astro upgrade is a separate task. No CMS: one editor, the owner. |
| D4 | **Bahasa Indonesia, addressed as "Anda"** (the landing's register: 88 × "Anda", 0 × "kamu" on 2026-10-12). UI labels are quoted **verbatim**, even where the Seller UI itself says "kamu". | A merchant matches the article to the screen by the exact label. |
| D5 | **Diátaxis split, tutorial first.** Phase 1 ships the one *tutorial* ("7 langkah toko siap jualan"); later chapters are *how-to* guides; a glossary and the fee table are *reference*. | `design-taste` docs anatomy; mixing them is what makes help centres unreadable. |
| D6 | **Each article declares the Seller routes it describes** (`routes:` in frontmatter). | Gives a cheap staleness guard (§10): a route that disappears from `page-map.json` should fail its article. |
| D7 | **Search = Pagefind, built into Starlight.** | Owner asked for search. Static, build-time index, no hosted service, no runtime dependency on our servers. Only works on a build (`astro build` + `preview`), not in `astro dev`. |

## 3. Claim rules (non-negotiable — inherited and extended)

1. **Everything an article says must be true in code on `main`.** Phase-1 facts were extracted from
   source on 2026-10-12 with file:line evidence (summarised in §8). If a doc and the code disagree,
   the code wins.
2. **The landing's "Never claim" list applies** (`apps/landing/DESIGN.md` → Claim sources): no
   e-wallet/minimarket/manual transfer for buyers, no COD beyond SPX + 6 provinces + Rp2.000.000,
   no email/WhatsApp notifications, no refunds as a merchant action, no instant couriers.
3. **ADR 0004:** never name KiriminAja or AutoLaris. The Seller UI says "TokoΦ Kirim" /
   "TokoΦ Bayar" (`packages/lib/src/provider-label.ts`); courier and bank names are fine.
4. **Say "Seller" / "Dashboard Seller"**, never "admin panel" (`AGENTS.md` → Naming).
5. **Shipping is on the courier's sandbox in production** (`KIRIMINAJA_ENV=sandbox`, Task 8.9). Until
   that flips, no article may promise that a booking sends a real courier. The order article carries
   a dated notice; remove it in the same commit that closes Task 8.9.
6. **No invented numbers.** Every price, limit or time in an article names its source in §8.

## 4. Information architecture (A–Z)

Home → chapters → articles. URL = `/<chapter>/<slug>/` on the docs host, Indonesian slugs (house rule).

| Chapter (`section`) | Articles (phase) | Seller routes |
|---|---|---|
| **mulai** — Mulai di sini | Tutorial: the 7 steps below (**phase 1**) | `/daftar` `/login` `/akun/*` `/pengaturan` `/produk` `/tema` `/navigasi` `/pesanan` `/saldo` |
| **produk** | Varian; foto; kategori (manual); inventori; pembelian (PO) (phase 2) | `/produk/**` |
| **tampilan** | Store Builder per template type; navigasi; halaman; blog; domain sendiri (phase 2) | `/tema` `/navigasi` `/halaman` `/blog` `/pengaturan` → Domain |
| **pesanan** | Status & tab; booking satu-satu vs massal; cetak label; retur; COD (phase 2) | `/pesanan/**` |
| **pelanggan** | Pelanggan & segmen; ulasan; keranjang ditinggal; obrolan; CRM (phase 3) | `/pelanggan/**` `/obrolan` `/crm/**` |
| **promo** | Voucher; flash sale; landing page `/lp` (phase 3) | `/diskon` `/flash-sale` `/promo` |
| **pemasaran** | Pixel Meta/Google/TikTok; feed katalog (phase 3) | `/pemasaran` |
| **uang** | Saldo & penarikan; penghasilan; langganan & faktur; biaya pembeli (phase 2) | `/saldo` `/keuangan/**` `/akun/langganan` |
| **tim** | Peran dan izin (6 roles) (phase 2) | `/pengaturan` → Pengguna |
| **referensi** | Glosarium (resi/AWB, COD, PPN, DPP…); tabel biaya; FAQ (phase 2) | — |

**Phase-1 tutorial — "7 langkah sampai toko siap jualan"** (`section: mulai`, `order` 1–7):

1. Daftar dan tunggu persetujuan — `daftar-toko`
2. Masuk dan amankan akun — `amankan-akun`
3. Lengkapi profil toko dan alamat jemput — `profil-dan-alamat`
4. Pilih jasa kirim dan atur COD — `pengiriman-dan-cod`
5. Tambah produk pertama — `tambah-produk`
6. Rapikan tampilan toko — `tampilan-toko`
7. Proses pesanan pertama — `pesanan-pertama`

## 5. Article template (content contract)

Frontmatter (validated by `src/content.config.ts`):

```yaml
title: "Tambah produk pertama"          # the H1
description: "…"                        # meta description; aim for 120–155 chars
routes: ["/produk", "/produk/baru"]     # Seller routes this article describes (D6)
verified: 2026-10-12                    # the date the facts were last checked against code
```

Order and grouping live in the sidebar config (`apps/docs/astro.config.mjs`), not in frontmatter.

Body, in this order — sections an article does not need are omitted, never left empty:

1. **One-paragraph lead:** what the reader will have when done.
2. **`## Yang Anda perlukan`** — prerequisites, each linking to the article that provides it.
3. **`## Langkah`** — a numbered list; every step = one screen action, naming the menu path and the
   exact button label in bold (`**Simpan**`). One screenshot per screen change, not per step.
   Ordered step lists are wrapped in Starlight's `<Steps>`; screenshots use `<Shot>`
   (`apps/docs/src/components/Shot.astro`: real capture, alt text naming what to look at, caption).
4. **Callouts** (Starlight asides): `:::caution[Penting]` for something that loses data, money or a
   sale; `:::tip[Tips]` for an optional shortcut; `:::note[Catatan]` for by-design behaviour that
   looks like a bug. Max three per article — more means the article is two articles.
5. **`## Kalau ada masalah`** — the exact error message (verbatim, quoted) → what to do.
6. Next/previous is Starlight's pagination; no hand-written "Langkah berikutnya" section.

## 6. UI/UX

Moved to [`apps/docs/DESIGN.md`](../../apps/docs/DESIGN.md) (2026-10-12) — reader and sequence,
reference evidence, direction, composition contract, states, SEO, owner-rule compliance and the
render critique. One design owner; this spec keeps scope, content rules and facts.

## 7. Accessibility and performance acceptance

One `<h1>` per page; heading order unbroken; keyboard order = reading order; `<details>` rail usable
by keyboard; contrast AA on the docs accent (measured with `design-taste/scripts/contrast.py`: `#4338ca` on white 7.90:1, `#818cf8` on Starlight's dark background `#17181c` 5.94:1); client JS limited to
Starlight's own (search dialog, theme switch, TOC); images responsive via `astro:assets` with real
width descriptors.

## 8. Phase-1 fact base (checked against code 2026-10-12)

Sources the seven articles rely on. Re-check this list when a referenced file changes.

| Fact used | Source |
|---|---|
| Sign-up open in production; fields and steps ①②③; "Nama lengkap" required on step ②; slug preview `.tokophi.id`; store created suspended "biasanya dalam 1×24 jam"; trial starts at sign-up | `apps/admin/app/daftar/daftar-form.tsx`, `lib/provision.ts:151-152,237-311`; live `app.tokophi.com/daftar` 2026-10-12 ("Tokomu, tayang hari ini", no Google button) |
| Storefront host `<slug>.tokophi.id` (`.tokophi.com` 301s to it) | `curl` 2026-10-12; `apps/admin/lib/data/domain.ts:30` |
| No email of any kind (approval, invite, reset); no forgot-password flow | `provision.ts:259`, `lib/actions/users.ts:60`, `lib/auth.ts:113` |
| Login errors, 2FA flow and copy; no backup codes | `app/login/login-form.tsx`, `lib/actions/auth.ts`, `akun/keamanan/security-client.tsx`, `lib/actions/security.ts` |
| Pengaturan tabs and every label in articles 3–4; COD switch; services grouped Same Day/Next Day/Reguler/Hemat/Kargo; at least one service required | `components/admin/pengaturan/*.tsx`, `pengaturan/page.tsx:59-83` |
| COD: SPX only, 6 provinces, ≤ Rp2.000.000; buyer pays 3% (min Rp2.500) + PPN 11% on the fee | `AGENTS.md` → Shipping & COD; `lib/cod-policy.ts`; `packages/lib/src/payment-fees.ts` |
| Missing pickup address → booking refused with the quoted message | `lib/actions/shipping.ts:220,769` |
| Product editor sections, labels, 2 MB/WebP, photos only after first save, max 2 option types, weight fallback 500 g, Aktif/Draft | `produk/[id]/product-editor.tsx`, `lib/image-store.ts:33-34`, `lib/shipping-weight.ts:32` |
| Category page lists only **manual** collection members; the editor's "Kategori" dropdown does not | `apps/storefront/src/data/catalog.ts:306,405` |
| Store Builder: Publish is the only save; 14 section types; Tampilan fonts/tones | `tema/[id]/builder-client.tsx:35`, `packages/sections/src/registry.ts`, `packages/lib/src/theme.ts` |
| Navigasi: header = menu handle `main-menu`/`main`, footer = `footer` | `apps/storefront/src/data/nav.ts:178,203-212` |
| "Kunjungi storefront" in the store switcher | `components/admin/topbar.tsx:218-226` |
| Order tabs, statuses, buttons; prepaid expiry 24 h; bulk booking uses the shopper's service, max 50; pickup tomorrow 10:00 WIB; resi arrives via 15-min poll; labels 100×150 mm | `components/admin/pesanan/*`, `lib/order-status.ts`, `api/cron/order-expiry/route.ts:12`, `lib/actions/bulk-shipping.ts`, `lib/actions/shipping.ts:1016-1026`, `api/cron/tracking` |
| Money: credited on payment / COD on selesai; withdrawable at `selesai`; payout needs Rekening; reviewed by hand, 1–2 hari kerja; no fee | `lib/ledger-credit.ts:158-172`, `saldo/saldo-client.tsx`, `specs/docs/PRICING.md` |

## 9. Delivery plan

1. **Phase 1 (done 2026-10-12, branch `feat/panduan`):** `apps/docs` — home, "Mulai di sini" + 7
   tutorial articles, Kamus (A–Z), Biaya dan harga, Status pesanan, Peran tim, Angka penting, FAQ;
   search; 10 real screenshots reused from the landing branch's redacted captures (demo store
   "Batik Nusantara", buyer names blurred).
2. **Missing screenshots** (need a logged-in Seller session on the demo store): Akun → Keamanan
   (2FA), Pengaturan → Profil Toko / Alamat / Rekening, Pesanan list, order detail with Cek Ongkir,
   Navigasi. Articles 2 and 3 currently have none.
3. **Deploy:** hostname **`panduan.tokophi.com`** (owner, 2026-10-12). Prepared on the branch: `site` set
   (canonical + sitemap + `robots.txt`), `apps/docs/Dockerfile` (runs `npm run check`, serves `dist`
   with nginx on 4339), service `docs` in `docker-compose.coolify.yml` with a `Host` router at
   priority 100 over the store wildcard, `panduan` added to `RESERVED_SLUGS`. No new DNS record: the
   proxied `*.tokophi.com` wildcard already resolves it (today it 301s to `panduan.tokophi.id`).
   Goes live when merged to `main` (Coolify auto-deploy) — owner-gated. Then link it from the
   landing footer and from the Seller panel's Bantuan screen.
4. **Phase 2 (done 2026-10-12):** chapters produk (5), tampilan (5), pesanan (5), uang (4), tim (3),
   each with an overview; facts checked against code with file:line (defects P12–P23 found).
   **Phase 3:** pelanggan,
   promo, pemasaran. Then contextual `?` links from each Seller screen to its article.

## 10. Guards

- `astro build` validates every page's frontmatter against the extended `docsSchema` (fails the build).
- `apps/docs/scripts/check-routes.mjs` (first step of `npm run check -w @tokophi/docs`): every `routes:`
  entry must be a Seller url in `specs/docs/page-map.json`; mutation-checked 2026-10-12 (a fake
  `/tidak-ada` route exits 1).
- `apps/docs/scripts/check-seo.mjs` (last step): title, description, author/publisher, WebP + ALT on the built site.

## 11. Product defects found while writing (filed here, not worked around silently)

Each is either fixed in the product or worded honestly in the article; none is hidden.

| # | Finding | Evidence | Article handling |
|---|---|---|---|
| P1 | 🔴 "Otomatis" collections save conditions that nothing evaluates — the category shows no products | `collection-editor.tsx`; storefront reads only `collection_products` | Article 5 tells the Seller to use **Manual**; fix or hide the option before the phase-2 kategori article |
| P2 | 🔴 Sandbox shipping in production shows "Mode demo … resi contoh" buttons to real merchants and books parcels no courier collects | `pesanan/[id]/page.tsx:22`, `order-detail.tsx:1171-1176`; Task 8.9 | Article 7 carries a dated notice |
| P3 | Langganan shows "Ditangguhkan" to a store that is only waiting for review | `akun/langganan/page.tsx:19,83` | Article 1 explains it |
| P4 | Profil Toko helper points the pickup address to "Pengaturan → Pengiriman"; it is under **Alamat** | `store-profile-card.tsx:273` | Article 3 gives the right path |
| P5 | Pengaturan page subtitle promises "pembayaran"; Pajak tab promises "NPWP" — neither exists; Notifikasi tab saves nothing ("Segera hadir") | `pengaturan/page.tsx:83,110-111`, `pajak-card.tsx` | Articles do not mention them |
| P6 | Pengguna card legend lists 3 roles and says Admin manages "pengaturan" (it cannot); 6 roles exist | `pengguna-card.tsx:24,125-127`, `lib/rbac-policy.ts` | Phase-2 tim article uses `rbac-policy.ts` |
| P7 | Halaman editor shows handle prefix `/pages/`; storefront URL is `/halaman/<handle>`; its "Template tema" and the collection editor's are not used | `halaman` editor; `apps/storefront/src/pages/halaman/[handle].astro` | Phase-2 articles give the real URL |
| P8 | Theme image picker toast says "Melebihi 5MB"; the cap is 2 MB (and `AGENTS.md` still says 5 MB for product media) | `components/theme/image-picker.tsx:35,159`; `lib/image-store.ts:33` | Articles say 2 MB; the `AGENTS.md` line was corrected 2026-10-12 |
| P9 | The order list's "Proses" button is offered on unpaid prepaid orders | `pesanan-client.tsx:433-456` | Article 7 says to wait for payment |
| P10 | `AGENTS.md` says storefronts are `<slug>.tokophi.com`; production serves `<slug>.tokophi.id` | `curl` 2026-10-12 | Articles say `.tokophi.id`; AGENTS.md corrected 2026-10-12 |
| P11 | `AGENTS.md` says "No Themes menu", but the Seller sidebar has a **Tema** menu (Store Builder); the PRD non-goal is "no Themes *marketplace*" | `apps/admin/lib/nav.ts:121`; root `PRD.md` | Articles and glossary use the real label **Tema**; AGENTS.md reworded 2026-10-12 ("No Themes marketplace") |
| P12 | 🔴 Purchase orders cannot be used by a real store: a PO needs a supplier, and only the seed creates suppliers (no Seller screen) → *"Pemasok tidak ditemukan…"* | `lib/actions/purchases.ts:147-162`; `packages/db/src/seed.ts:1502` | `produk/pembelian` opens with a dated caution |
| P13 | 🔴 The blog editor pre-fills a real person's name as **Penulis** for every merchant; it is shown on the storefront article | `blog/[id]/article-editor.tsx:65`; storefront `blog/[handle].astro:157` | `tampilan/artikel-blog` tells the Seller to replace it (name not repeated) |
| P14 | 🔴 Bulk label print sends only the first 50 orders but marks every selected order **Sudah** dicetak | `api/admin/labels/route.ts` (`slice(0,50)`); `pesanan/massal/massal-client.tsx:137-167` | `pesanan/cetak-label`: print ≤ 50 at a time |
| P15 | Product editor **Simpan** overwrites stock with the on-screen number (sales made while open are lost); Inventori has a stale check | `lib/actions/products.ts:171-188` vs `lib/actions/inventory.ts:90-93` | `produk/inventori` recommends Inventori |
| P16 | Switching a category Manual → Otomatis deletes its manual members on save (worsens P1) | `lib/actions/collections.ts:52` | `produk/kategori` caution |
| P17 | P9 worse: **Proses** on an unpaid prepaid order moves it to Diproses, where the 24 h expiry no longer cancels it | `pesanan-client.tsx`; `api/cron/order-expiry/route.ts` (`status = baru`) | `pesanan/tab-dan-status` caution |
| P18 | List **⋯ → Batalkan** cancels with no confirmation and leaves the courier booking alive; manual **Selesaikan** on COD credits cash with no confirmation | `pesanan-client.tsx:249-258`; `lib/ledger-credit.ts:92-111` | Cautions in `tab-dan-status`, `pesanan-cod`; `referensi/status-pesanan` corrected |
| P19 | New stores get no templates and no menus; header/footer only use handles `main-menu`/`main`/`footer`, derived from the typed title and never explained; menus can't be deleted | `lib/provision.ts`; `lib/actions/menus.ts:114-128`; storefront `data/nav.ts:203-212` | `tampilan/menu-navigasi` gives the title trick; `mulai/tampilan-toko` corrected |
| P20 | Halaman and Blog **SEO/Tag** fields are never saved; blog editor shows `/blogs/` (real `/blog/<handle>`); **Dilihat**/**Komentar** columns have nothing behind them | `page-editor.tsx:71-91`; `article-editor.tsx:69-121,246,293` | Notes in the articles |
| P21 | Pengguna card knows only 4 role labels: Advertiser/CS badges render empty, "already invited" prints raw `advertiser`/`cs`; **Keluarkan** has no confirmation; owners can land on another store at login (owner membership has no invite date) | `pengguna-card.tsx:24,101,113,174-178`; `lib/store-selection.ts`; `lib/provision.ts:288` | `tim/*` articles |
| P22 | Saldo **Sudah ditarik** counts a payout from request and keeps it after rejection; **Tarik**/**Bayar** shown to roles or states that the server refuses with a masked error | `lib/data/ledger.ts:115`; `saldo-client.tsx:391`; `akun/langganan/page.tsx:86` | `uang/*` say owner-only / not while read-only |
| P23 | Inventori search claims SKU but doesn't search it; **Total SKU** counts products; PO form pre-fills HPP at 60 % of price; domain card tells root domains to CNAME `@` | `inventori-client.tsx:241`; `pembelian-client.tsx:266`; `domain-card.tsx:290-294` | Notes/tips in the articles |
