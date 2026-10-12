# TokoΦ landing (tokophi.com) — design record

Owner of visual and UX decisions for `apps/landing`. Product scope lives in
`specs/docs/LANDING_PRD.md`; facts about what the product does live in code (see "Claim sources").
Redesign started 2026-10-11 (branch `feat/landing-sales`) on the owner's request: make the apex a
complete sales and introduction page, including subscription pricing, homepage first, section by
section.

## Audience, job, decision sequence

- **Reader:** an Indonesian online seller (fashion, beauty, food, home goods) who already sells on
  marketplaces or by WhatsApp and wants their own store. Often runs ads (Meta/TikTok), often sells COD.
  Mostly on a phone. Evidence status: assumed from the owner's brief and the product's design (COD,
  pixels, WhatsApp-first identity); no analytics were supplied.
- **Job:** decide whether TokoΦ can run their store end to end, what it costs them AND their buyers,
  and whether it is safe to try.
- **Sequence:** what is it (hero) → does it cover my workflow (real screens, step by step) → does it
  help my ads (marketing) → what exactly is included (feature index) → what does it cost, who pays
  which fee (fees + pricing) → can I see a real store (demo) → start trial. (A FAQ section was built
  and removed on the owner's call, 2026-10-11: "faq sepertinya belum perlu". The facts it carried —
  COD limits, review on signup, read-only grace — live in the fact row and the pricing panel.)
- **One primary action:** "Coba gratis 3 hari" → `app.tokophi.com/daftar`. Secondary: "Lihat toko
  demo". No WhatsApp CTA (owner invariant; no official channel is configured yet anyway).

## Claim sources (nothing on the page may go beyond these)

| Claim | Source of truth |
|---|---|
| Price: 3-day trial, Rp50.000 first month, Rp275.000/month, Rp2.700.000/year (= Rp225.000/month), first annual payment straight after trial = 13 months, 3-day grace then read-only, storefront stays up | `packages/lib/src/billing.ts` (`BILLING`, `quote`) |
| Buyer-paid fees: QRIS 0,7% of goods, VA Rp3.000 (BCA Rp6.500), COD 3% (min Rp2.500) + PPN 11% on the fee | `packages/lib/src/payment-fees.ts`, `specs/docs/FINANCE.md` |
| Live channels: QRIS + VA BCA/BNI/BRI/Mandiri/Permata | BUILD-LOG 2026-09-23; e-wallet/minimarket exist in code but are OFF — never claimed |
| COD: merchant opt-in, SPX only, 6 provinces, ≤ Rp2.000.000 | `apps/admin/lib/cod.ts` |
| 10 couriers, live rates from the seller's pickup address, bulk booking, waybill auto-filled every 15 min, thermal labels | `packages/lib/src/couriers.ts`, `apps/admin/lib/actions/shipping.ts`, `api/cron/tracking` |
| Withdrawal: min Rp200.000, no fee, reviewed by hand | `/saldo` screen (captured), FINANCE.md |
| Pixels Meta/TikTok/Google + server-side, feeds Google/TikTok | `lib/capi.ts`, `/pemasaran` screen (captured) |
| Store Builder 14 section types, 5 font pairings, 3 tones | `packages/sections/src/registry.ts`, `packages/lib/src/theme.ts` |
| Custom domain, chat, landing page COD form, vouchers + flash sale, abandoned-cart WA links, CRM, 6 team roles, 2FA | feature inventory 2026-10-11 (code on `main`) |
| New signups are reviewed before the store can be edited | `apps/admin/lib/provision.ts` (store created suspended, pending review) |
| "Tanpa kartu kredit" | `apps/admin/app/daftar/daftar-form.tsx` — signup asks store, account, owner and pickup-address fields only; subscription is billed later by Virtual Account (`billing.ts`) |
| "Tanpa batas jumlah produk" | No product-count limit exists in code (searched `apps/`, `packages/` 2026-10-11 for product caps; the only `MAX_PRODUCTS` is the storefront search palette's 6 rows) |
| Photos converted to WebP | Product editor states "Maks 2MB per gambar · otomatis dikonversi ke WebP" (`design/shots/produk-editor.png`); `apps/admin/lib/image-store.ts` |
| Store PPN: prices with or without tax | `packages/lib/src/tax.ts`, Pengaturan → Pajak |
| Orders turn paid automatically when the payment provider confirms (no transfer-proof matching) | `apps/admin/app/api/public/pay/callback/route.ts` (provider callback marks the payment and order paid; idempotent, exact-amount gate) |
| Checkout shows QRIS, Virtual Account (Permata, BCA, BNI, BRI, Mandiri) and COD once a kecamatan is chosen | `design/shots/sf-checkout-bayar.png`, live demo checkout 2026-10-12 |
| Storefront SEO: sitemap, JSON-LD, light images | `apps/storefront/src/pages/sitemap*`, `robots.txt.ts`, JSON-LD in PDP/collection pages, `imageSrcSet` (AGENTS.md "Storefront performance") |

**Never claim:** affiliate programme, buyer accounts, e-wallet/minimarket/manual transfer, COD on
other couriers or nationwide, product import, email/WhatsApp notifications, buyer-submitted reviews,
refunds, on-demand instant couriers (GoSend/Grab-style; the same-day and next-day KiriminAja services in Pengaturan are real and may appear), AI copywriting, customer counts, testimonials, ratings.

## Reference evidence

Captured 2026-10-11 with `scripts/ui-ref.mjs` (390 and 1440 px), screenshots opened and inspected.
Captures are local research material (the refs folder is git-ignored).

| Reference | Role | Observed | Transfer / reject |
|---|---|---|---|
| `design/refs/scalev/1440.png`, `design/refs/scalev/390.png` (scalev.id, local COD/LP SaaS) | Directional, local market | Huge centred headline with a highlighted word, stat row "100K+ 10jt+ 300jt+ 99.9%", 3 equal feature cards, a numbered "3 aksi" card row, a testimonial section whose content had not rendered at capture time (blank), FAQ accordion, navy closing band | Transfer: the local buyer's vocabulary (LP, COD, Meta CAPI, followup) and an accordion FAQ. Reject: highlighted headline word, unsourced stat row, equal card rows — the category default this page must escape |
| `design/refs/orderonline/1440.png`, `design/refs/orderonline/390.png` (orderonline.id) | Directional, local market — pricing and payment-logo norms | Long page of illustrated feature blocks, courier and payment logo strips, testimonial grid, 3-tier pricing (Personal/Business/Enterprise) with monthly/annual toggle, media logos | Transfer: Indonesian sellers expect to SEE price, a monthly/annual switch, and the courier/payment list named explicitly. Reject: stock 3D illustrations, testimonials and media logos (we have none we may publish), 3 tiers (we sell one plan) |
| `design/refs/berdu/390.png` (berdu.id) | Mobile hero benchmark | Plain hero: bold headline, five checklist lines naming concrete jobs, "Gratis 14 hari, tanpa komitmen", one full-width CTA | Transfer: on a phone the hero must name concrete jobs and trial terms above the fold with one obvious button |
| `design/refs/shopify-pricing/1440.png` (shopify.com/id/harga) | Blocked | Rendered Shopify's 404 page (localized URL redirected); no pricing evidence obtained | Not used for any decision |
| `design/refs/lynk/1440.png`, `design/refs/lynk/390.png` (lynk.id) | Blocked | Both captures are a Cloudflare "you have been blocked" page; no evidence obtained | Not used for any decision |
| `design/refs/mayar/1440.png`, `design/refs/mayar/390.png` (mayar.id, Indonesian payment and checkout platform; captured 2026-10-12) | Composition precedent, local market | Hero shows the real seller dashboard in a browser frame under the headline; below, rows alternate copy with a real product screen plus a small overlaid UI card; a logo row and a "149,969+ bisnis / 96% kepuasan" stat row | Transfer: a local payments product leads with its own dashboard and pairs each claim with the screen that does it, the same "show the panel" composition. Reject: the stat row and logo row (no figures we may publish), red/blue pill grid |
| `design/refs/shopify-id/1440.png`, `design/refs/shopify-id/390.png` (shopify.com/id; captured 2026-10-12) | Composition precedent, global category leader | Product UI shown inside phone frames and store screens, sized so the screen reads as evidence; dark full-bleed bands; one CTA style throughout | Transfer: phone-framed real storefront screens as proof of the buyer experience. Reject: lifestyle photography and AI-feature theme (nothing comparable to show truthfully) |
| Seller panel captures `design/shots/produk.png`, `design/shots/produk-editor.png`, `design/shots/builder.png`, `design/shots/pesanan_massal.png`, `design/shots/pemasaran.png`, `design/shots/saldo.png`, `design/shots/sf-pdp.png`, `design/shots/sf-checkout.png` (local Dashboard Seller on the production copy, demo store "Batik Nusantara", buyer names blurred, account badge hidden) | Product evidence | Real screens: Produk (list + editor), Store Builder, Pengiriman Massal, Pemasaran, Saldo, storefront PDP on mobile | These ARE the page's imagery. Nothing is drawn in divs |

## Direction

**"Show the panel, name the price."** A calm, factual sales page whose identity comes from the
product's own screens and from radical fee transparency — the thing no local competitor page does
(they all show a subscription price; none says who pays the QRIS/VA/COD fee or the shipping).

- **Composition:** left-aligned editorial column + large real screenshots, not a centred
  badge/headline/two-buttons stack. Screens sit in a thin device frame (1px hairline, 12px radius,
  one soft shadow) — the only "card" treatment on the page besides the price panel.
- **Type:** display = Source Serif 4 (variable, OFL, self-hosted, latin subset) — continues the serif
  Φ mark the current site already uses, but now identical on every device (the old system serif
  stack fell back to Georgia/Noto Serif per OS). Body/UI = system sans (fast, and close to the
  Dashboard Seller UI shown in the screenshots). No monospace labels, no tracked uppercase eyebrows
  over every heading (the current page has one over every section — a template tell).
- **Colour (light, single theme + existing dark scheme kept):** canvas `#fbfbfe`, surface `#fff`, ink
  `#14152a`, muted `#575c7c`, line `#e3e5f2`; primary `#4f46e5`.
  `gate-allow: accent — #4f46e5 is the shipped TokoΦ brand AND the Dashboard Seller's primary; the
  screenshots on this page are indigo, so a different accent would make the site disagree with the
  product it shows.` One dark ink band (`#14152a`) is reserved for the pricing section so the price is
  the page's strongest contrast moment.
- **Shape:** radius 8px controls, 12px media frames and the price panel; no rounded wrappers around
  sections; sections separate by whitespace and background shift (canvas ↔ white ↔ ink).
- **Icons:** inline Lucide SVG, functional only (truck, qr-code, wallet…). lucide-react and React are
  removed from the landing.

### Ornament, type scale, chrome (owner 2026-10-12: "bg dibuat ornament, jangan terlalu polos; hindari AI slop")

- **Ornament = the brand's own geometry.** Φ is the golden ratio, so the one background device is a
  golden rectangle subdivided into its squares with the spiral through them (`PhiOrnament.astro`,
  computed, 1px strokes, `aria-hidden`). Placed where a left-aligned layout leaves an empty half:
  hero (behind the screenshot), inner-page intros, the closing band, and the pricing ink band (white,
  12%). Never behind running text, never more than one per section. Rejected as template signals:
  gradient blobs, dot/graph-paper grids (removed 2026-10-11), noise textures, floating icon tiles.
- **Type scale** as tokens in `global.css`: display `clamp(2.4rem → 3.5rem)`, section
  `clamp(1.85rem → 2.625rem)`, item heading `clamp(1.25rem → 1.5rem)`, lede `clamp(1.0625rem →
  1.1875rem)`, list item 1.0625rem, small 0.875rem — about 1.33 between steps. The hero headline is
  capped at 3.15rem because it shares its row with the screenshot.
- **Header:** one indicator for hover and current page, a 2px indigo bar under the label (40% on
  hover, full on the current page); weight never changes, so the row never reflows. Mobile menu marks
  the current page with a dot. **Buttons** lift 1px on hover and settle (scale .98) when pressed.
- **Footer:** the page closes on the same ink as the pricing band (one dark frame per page plus the
  footer); four columns (brand + price line + CTA, Produk, Akun, Informasi), real links only, no
  social icons or badges we cannot back. Text #b9bede / #9298c4 on #14152a = 9.81:1 / 6.41:1.

### Motion concept (revised 2026-10-12: owner "jika berat sempurnakan… fokus SEO friendly dan tidak berat")

| Tool | Decision | Why |
|---|---|---|
| **GSAP + ScrollTrigger** | **Removed** (was used until 2026-10-12) | 115 KB JS (45 KB gzip) for two effects. The hero entrance faded the H1 and screenshot in, which holds back the largest contentful paint. |
| **CSS scroll-driven animation** (`animation-timeline: view()`) | **Use** for product screenshots below the fold (`[data-settle]`) | Each screenshot settles in (opacity + 3rem rise) as it enters the viewport, so the five workflow steps read in order. Runs off the main thread, 0 KB JS. Browsers without support and reduced-motion visitors see the screenshots in place. |
| **Hero entrance** | **Dropped** | Nothing above the fold animates: the H1 and hero screenshot paint at once (LCP). |
| **Lenis / any smooth-scroll library** | **Rejected** | It replaces native scroll (anchors, keyboard paging, find-in-page, trackpad momentum), fights reduced motion, and adds JS to every visit. Anchor links get native `scroll-behavior: smooth` instead, only without reduced motion. |
| **Checkout state sequence** | CSS keyframes crossfade of four real captures | No JS; still frame under reduced motion. |
| **CSS transitions** | Hover/press/focus, nav indicator, pricing toggle | No JS. |

Measured after the change (local, Lighthouse 12.8.2 mobile): home Performance 98 / A11y 100 / BP 100 /
SEO 100, LCP 2.4 s, TBT 0 ms, CLS 0; /fitur 99/100/100/100 (was 92 on home with GSAP). Client JS
bundles: 0 files (only the inline menu script and JSON-LD remain). Scroll-driven settle verified in
Chrome: opacity 0 below the fold → 0.91 entering → 1 once in view.

## Page anatomy — homepage (`/`)

| # | Section | Content | Layout (wide → narrow) |
|---|---|---|---|
| S1 | Header | Logo, Fitur, Harga, Cara kerja, Bayar dan kirim, Demo, Masuk, **Coba gratis** (FAQ link removed with the FAQ section; the old `/faq/` page still exists, unlinked from the menus) | Sticky, compact. Narrow: logo + CTA + menu button opening a native `<dialog>` (replaces the React Sheet) |
| S2 | Hero (phone overlay removed in pass 5: it covered table columns; the buyer view lives in step 3 and the demo) | H1 + one-sentence promise naming the jobs (domain sendiri, QRIS/VA/COD, 10 kurir, tanpa akun PG/kurir sendiri); CTAs; price line "Rp50.000 bulan pertama, lalu Rp275.000/bulan · tanpa komisi penjualan" | Text left 5/12, Produk screenshot right bleeding off-canvas with the mobile PDP overlapping. Narrow: text, CTAs, price line, then the screenshot cropped |
| S3 | Fact row | 4 verified facts with an icon each: QRIS + VA 5 bank · 10 kurir, ongkir otomatis · COD lewat SPX · 0% komisi penjualan | One hairline-separated row; 2×2 on narrow. Text, not stat cards |
| S4 | Alur kerja (5 steps) | Susun katalog → Rancang tampilan toko → Pembeli checkout tanpa akun → Kirim massal, resi otomatis → Saldo & pencairan | One row per step: copy 4/11 left, its real screenshot 7/11 right; stacked on narrow |
| S5 | Untuk yang beriklan | Full-width Pemasaran screenshot (per-channel orders/revenue), then a 3-column list: pixel + server-side Meta/TikTok/Google, feed katalog, landing page form COD, voucher & flash sale, keranjang ditinggal via WhatsApp, chat | White band; screenshot full width, list 3 → 2 → 1 columns |
| S6 | Semua fitur | Grouped plain lists (Toko & tampilan · Penjualan & pembayaran · Pengiriman · Pemasaran · Operasional & tim) + link "Lihat rincian fitur" | Multi-column text lists, no cards |
| S7 | Biaya transparan | "Siapa membayar apa" table: langganan (seller) · biaya pembayaran (pembeli, di checkout) · ongkir (pembeli, tarif kurir) · pencairan saldo (gratis, min Rp200.000) | Real `<table>`; narrow: stacked definition rows |
| S8 | Harga | One plan "TokoΦ — semua fitur". Bulanan/Tahunan switch (native radios + CSS `:has`, no JS). Includes list, trial terms, grace/read-only rule, review-before-edit note | Ink band; price panel left, includes list right. Narrow: stacked |
| S9 | Toko demo | Storefront mobile screenshot + link to `batiknusantara.tokophi.id` | White band; two columns / stacked |
| S11 | Penutup | Short restatement + primary CTA + secondary "Lihat harga" | Left-aligned band |
| S12 | Footer | Routes, Masuk, Kontak, Privasi, © | Existing structure |

States: CTA links only (no forms on this page). The pricing switch is keyboard-operable radios with a
visible focus ring; with `:has` unsupported, both prices render (no hidden price).

## Page anatomy — inner pages (2026-10-12, owner: "sisanya kau sempurnakan")

Every inner page opens on `PageIntro` (serif H1 naming the page's question, one-sentence answer, the
same two actions as the homepage), uses the homepage's band rhythm, real screenshots only, and ends on
`Closing`. Repeated topics reuse the homepage components instead of new variants.

| Page | Job | Sections |
|---|---|---|
| `/fitur/` | Check that one specific feature exists | Intro + jump links (Toko, Penjualan, Pengiriman, Pemasaran, Operasional) → five `DetailSection`s, each = H2, its real screen, a two-column list of feature + one-sentence explanation (phone screen sits beside the list) |
| `/cara-kerja/` | Know the order of events and when money is due | Four signup steps (numbered: a real sequence) beside the real signup form on a phone (the review queue is described in words; it has no seller-facing screen worth showing) → homepage `WorkflowStory` → billing timeline from `BILLING` (trial, first month, monthly/annual, grace then read-only) |
| `/pembayaran-pengiriman/` | Know how buyers pay, how parcels ship, how money comes out | Payments (checkout phone) → COD rules (no screen; list only) → couriers + bulk shipping → Saldo → "Siapa membayar apa" table |
| `/demo/` | Try the storefront as a buyer | Intro whose primary action opens the demo host → two staggered phones (beranda, halaman produk; stacked and centred below 600px) beside a numbered "Yang bisa dicoba" list |
| `/faq/` | Retired | 301 → `/harga/` (`astro.config.mjs` redirects) |
| `/kontak/`, `/privasi/` | Legal | Content unchanged; notice now says the operating entity is being registered (owner, 2026-10-12) |

React is gone from the landing: `FeatureIconGrid.tsx`, `MobileNav.tsx` and the old section components
were deleted with `@astrojs/react`, `react`, `react-dom` and `lucide-react`.

## Open questions (owner)

| Question | Blocks |
|---|---|
| Subscription PPN toggle is OFF today; if it is switched on, the page must say "belum termasuk PPN". Keep the page silent on PPN until then? | Nothing now; recheck when the toggle changes |
| Using the demo store's real Saldo / Pemasaran screens as imagery | Resolved 2026-10-12: kept (owner: "jalankan sesuai rekomendasimu"; it is the public demo store) |
| Legal identity + contact (`PUBLIC_LEGAL_*`, `PUBLIC_CONTACT_*`) still unset: the entity is being registered (owner, 2026-10-12); pages say so | Ads review; fill the env vars when issued |

## Render critique

Author: Claude Code (claude-opus-5-5), builder of this page — not an independent review.

Renders (fresh, built from current source, local `node dist/server/entry.mjs`):
`design/renders/home-390.png`, `design/renders/home-1440.png`, `design/renders/harga-390.png`,
`design/renders/harga-1440.png`. Viewport slices were also inspected during the macro and refinement
passes (1440×900 and 390×844).

Pass 1 (macro, after first build) — findings fixed:
- Hero H1 wrapped to six one-word lines at 1440 (copy column 5/12 with a 4.1rem headline). Headline
  shortened, columns 11/13, max size 3.35rem → four lines at 1440, four at 390.
- Workflow story: the sticky frame was correct (measured `top: 146px`, `position: sticky`) but every
  desktop screenshot sat ~480px low. Cause: the frame's implicit grid row sized itself to the phone
  screenshot's natural 1600px height. Fixed with a fixed `100% / 100%` track; slides now centre in
  the frame beside the active step.
- Feature index left one orphan group on its own row (auto-fit at 1440). Now 5 columns ≥1200px, 3, 2, 1.
- A divider above the closing section duplicated the FAQ band edge; removed (owner default:
  background shift, not rules).

Pass 2 (refinement) — section-by-section against §4.3.1:
- S2 Hero: left-aligned text with a real Seller screenshot bleeding right and the storefront phone
  overlapping; not the centred badge/headline/two-CTA template. Trial terms and both prices are in
  the first viewport at 390 and 1440. OK.
- S3 Fact row: four facts in one hairline row with functional icons; text, not stat cards; every
  figure is from code. OK.
- S4 Story: real screens, one per step; "Langkah 1–5" numbering is a true sequence. On 390 each
  step shows its own screenshot inline (no pin). OK.
- S5 Ads: one large real screen + a list, asymmetric. Long right column leaves white space under the
  screenshot at 1440; the screenshot is sticky so it stays beside the list while reading. Accepted.
- S6 Feature index: plain grouped lists with a strong top rule per group; no cards. OK.
- S7 Fees: a real table at 1440, stacked rows at 390 ("Dibayar oleh" wrapped onto two lines at 390 —
  fixed by releasing the desktop column widths in the narrow layout). OK.
- S8 Pricing: the only dark band and the only panel; the price is the page's largest number. The
  toggle works by keyboard (ArrowRight switches to Tahunan; verified). "hemat Rp 600.000" wraps
  under "Tahunan" at 390 — legible, accepted.
- S9 Demo (white band, so it does not merge into the closing), S11 Closing: quiet, left-aligned. The FAQ section was removed on the owner's instruction. On /harga the closing's second
  button pointed back to /harga; now "Lihat toko demo".
- Tells check: no highlighted headline word, no tracked-uppercase eyebrows on this page, no mono
  labels, no `01/02` decoration, no testimonials or invented numbers. Accent indigo is the shipped
  brand (gate-allow recorded under Direction).

Pass 3 (after independent review round 1 = REVISE, `design/review.md`) — every finding addressed:
- Workflow story: the pinned crossfade showed Saldo beside step 1 when scroll was restored and left a
  ~2,500px empty column beside steps 2–5 in a full-page view. Replaced by one row per step (copy left,
  its own screenshot right; stacked on narrow) with a play-once settle-in. The phone step centres in
  its column. Design record "Motion concept" updated accordingly.
- Saldo screenshot re-captured without the Next.js dev badge; step 5 copy now matches what the
  screen shows ("Daftarkan rekening sekali, lalu tarik…" — the demo store has no bank account set,
  so the screen shows that prompt).
- Hero: phone moved onto the screenshot's sidebar corner (product names stay visible); on <1024px
  the hero uses a tighter crop of the same Produk screen (`seller-produk-crop`) and drops the phone.
- Courier names now appear as text (fact row: first five + "5 lainnya"; feature index: all ten).
- Feature index: two columns down to 340px with tighter rows (was ~3 screens of single-column rows).
- Pricing toggle: "hemat Rp600 rb" (compact) so it no longer wraps at 390.
- Demo and hero phone screenshots re-cropped above the storefront's bottom bar / chat button.
- Closing: "Daftar sekarang, mulai jualan setelah disetujui." (no unsourced "this week" promise).
- Footer: product facts instead of generic taglines; FAQ link removed from header and footer.
- /harga: the pale strip between header and the dark band removed (first band pulls up by the
  shell's row gap).
- Lynk reference re-labelled Blocked (both captures are a Cloudflare block page).

Pass 4 (after review round 2 = REVISE):
- Storefront phone re-cropped above the product title/breadcrumb (hero and step 3 no longer cut a
  line of serif text in half).
- Step 1 now shows the product EDITOR (`seller-produk-editor`), so it adds information instead of
  repeating the hero's product list.
- Annual saving moved out of the toggle into a note under it ("Bayar tahunan hemat Rp600 rb …"); the
  toggle no longer wraps at 390.
- Closing headline limited to 34rem.
- Every remaining claim given a source row in "Claim sources" (no card at signup, no product cap,
  WebP, store PPN, storefront SEO).
- Scalev note corrected (its testimonial area was blank because it had not rendered at capture).

Pass 5 (after review round 3 = REVISE, "screens unreadable"):
- Every Seller screenshot is now a crop of its 2880×1800 capture cut to what the copy names
  (Produk table; editor with the WebP note; builder components + canvas; bulk-shipping filters +
  Generate resi; Saldo cards + Tarik saldo; Pemasaran feed URLs + channel cards). Text in them reads
  at roughly 0.7–0.85× of the panel's own size at 1440.
- Hero phone overlay removed (it covered prices once the hero screen was cropped).
- Feature index: one column below 420px.
- Pricing: includes list centred against the price panel (no dead ink area).
- /harga: tighter closing top padding.
- Demo URL `batiknusantara.tokophi.id` verified 200 (2026-10-11); `.tokophi.com` store hosts redirect to `.id` (DEPLOY.md 2c-redirect).

Pass 6 (after review round 4 = REVISE, "unreadable on a phone; step 3 shows no checkout"):
- Every Seller screen now has a `-narrow` crop (two or three elements, ~900px source) served below
  1024px through `<picture>`; desktop crops narrowed to ≈1:1 CSS at their column width.
- Step 3 now shows the real demo-store CHECKOUT on a phone (contact, name, WhatsApp, address,
  kecamatan, kode pos, shipping) — captured on the public demo storefront by adding one item to the
  cart and opening /checkout, without typing or paying.
- Ads: screenshot full width (attributed orders and revenue per channel, whole cards), list below in
  three columns — no empty column, numbers legible.
- Fact row title "COD lewat SPX"; fees payer column "Tidak ada" instead of "Gratis"; one money
  format everywhere (`Intl` id-ID: "Rp 600.000"); price includes list top-aligned with the panel;
  nav label "Bayar dan kirim".

Pass 7 (after review round 5 = REVISE, "crops cut words at the frame edge"):
- No more coordinate crops. Each Seller screen is re-captured from the running panel and clipped
  programmatically to the `<main>` column, ending at the bottom of the last whole element: desktop at
  a 1180px viewport, narrow at 390px (the panel's own phone layout, so cards and columns reflow
  instead of being cut). Builder narrow = its component list only.
- Found while doing this: the Seller product editor's "Judul" row overflows the screen at 390px (a
  real Dashboard Seller bug, reported to the owner, not fixed here); the editor's narrow crop starts at
  Deskripsi.
- Ads screenshot shown at its captured CSS width (no upscaling); fact-row vertical dividers removed;
  recurring price "Selanjutnya Rp 275.000 per bulan" one step larger; header background more opaque
  so the canvas glow does not show behind it on /harga.

Behaviour verified in a real browser (Playwright + system Chrome): mobile menu opens as a modal,
focus moves inside, Escape closes and focus returns to the menu button; pricing radios switch the
visible price; reduced-motion gets the stacked story with inline screenshots; one `h1`,
no duplicate ids, every `img` has `alt`; 0 console errors at 390 and 1440; no horizontal overflow.
Lighthouse mobile (local, uncompressed server): Performance 92, Accessibility 100, Best Practices
100, SEO 100; TBT 0 ms, CLS 0.

Pass 8 (inner pages, 2026-10-12; review log cleared on the owner's go-ahead after the 5-round cap):
- Rendered `/fitur/`, `/cara-kerja/`, `/pembayaran-pengiriman/`, `/demo/`, `/kontak/`, `/privasi/`
  at 390 and 1440 (screenshots inspected: design/renders/home-390.png, design/renders/home-1440.png, design/renders/harga-390.png, design/renders/harga-1440.png, design/renders/fitur-390.png, design/renders/fitur-1440.png, design/renders/cara-kerja-390.png, design/renders/cara-kerja-1440.png, design/renders/bayar-kirim-390.png, design/renders/bayar-kirim-1440.png, design/renders/demo-390.png, design/renders/demo-1440.png): 0 console errors or warnings, no
  horizontal overflow, one `h1` each, every image has `alt`, titles 55–70 and descriptions ≤ 155.
- Builder screenshot ended on a half-cut "Banner Koleksi" row → cropped to end below "Navigasi
  Kategori". Pemasaran (desktop and narrow) began with the bottom edge of a cut-off card → top 22px
  removed.
- `/fitur/`: five sections alternate white/canvas bands so a long page keeps its place; jump links are
  real anchors. Generic-check: no card grid, lists are plain rows, each section is tied to a screen.
- `/cara-kerja/`: the numbered circles mark a real four-step sequence; billing timeline uses the same
  four-column rhythm without numbers (it is a schedule, not steps).
- `/demo/`: the second phone is offset downward so the pair reads as two moments of one visit.

Pass 9 (after review round 1 of 2026-10-12 = REVISE):
- Every Seller screen re-captured (local panel on the production copy, read only) and clipped at a
  line that no row or card crosses: the clip script lists every element bottom inside the height
  budget and takes the lowest one that no element shorter than 600px straddles. Product editor now
  ends below the whole Harga card; bulk shipping ends below whole table row 2 (desktop) and below
  the whole action bar + note (phone); Produk narrow ends below one whole product row.
- The "Impor" button is hidden in the Produk captures: product import is on the Never-claim list, so
  the imagery must not show it. The fourth filter tab is hidden on the phone capture so no tab label is
  cut at the edge.
- Pemasaran: desktop now shows the "Penjualan yang diatribusikan per saluran" table (Meta, Google,
  TikTok, total Rp 42.674.978) instead of the "Tidak tersedia" card; phone shows the two whole
  summary cards (122 orders, Rp42.7 jt).
- Store Builder captured at 1440 (canvas at 63% shows whole category tiles), top bar and the
  collapsed Outline panel left out; phone variant = the canvas (hero + four whole tiles), not the
  component list.
- /cara-kerja: the real signup form (captured at 390, nothing submitted) sits beside the four steps;
  the "daftar dengan akun Google" claim was removed after checking production (no Google button on
  app.tokophi.com/daftar).
- /demo: checkout phone replaced by the product page (gallery + title; the star rating below it is
  left out, ratings are on the Never-claim list); phones stack at full width below 600px.
- Pricing note "Bayar tahunan hemat…" #a9b0ff on #14152a = 8.83:1 (contrast.py), passes AA.
- Re-rendered (same paths as pass 8): 0 console errors, 0 overflow, one h1, all alts, at 390 and 1440.

Pass 10 (after review round 2 of 2026-10-12 = REVISE, "no payment choice in any checkout image"):
- New checkout capture from the live demo store: one product in the cart, kecamatan "Gubeng" picked,
  QRIS selected; no name, WhatsApp, address or payment entered. It shows SPX Standard Rp 5.700, the
  three payment choices (QRIS, Virtual Account with the five banks, COD) and the total with the QRIS
  fee (`design/shots/sf-checkout-bayar.png`). Used on home step 3, /fitur Penjualan and
  /pembayaran-pengiriman Pembayaran; the address-form capture is retired. Side effect: the demo
  store's own analytics/pixels and a checkout-session record fired, as on 2026-10-11.
- Workflow rows: copy top-aligned and sticky (top 6rem) beside tall screens, static under 1024px.
- Bulk shipping recaptured at a 1280 viewport (table ends 24px inside <main>), blur limited to the
  Pembeli cells (the "Layanan" header is clean), clip ends on table row 2.
- Builder: cut below the first whole row of category tiles; component rows that would cross the cut
  are hidden (the list scrolls in the real builder).
- Desktop screen frames span the full section width, the same as the lists under them.
- /cara-kerja narrow: the signup phone sits right under the heading, before step 1 "Daftar".
- /demo narrow: stacked phones centred.

Pass 11 (after review round 3 = REVISE, "screens must agree with the text beside them"):
- Step 3 copy rewritten to what its screen shows: no account, kecamatan → ongkir → QRIS/VA/COD.
- Signup phone cropped below the form's own header ("Tokomu, tayang hari ini" contradicts the
  review step); it now opens on the three-step bar and the account fields.
- Saldo desktop cropped above the "Tarik saldo" card: its "Lengkapi rekening bank" warning sat next to
  "Sudah ditarik Rp 23.500.000". The minimum is still stated in the copy (claim source: /saldo).
- Produk crops end exactly on the third row's bottom rule (no sliver of a fourth row). The
  "Terjual 0" column is left as captured: it is the demo store's real per-product count, and hiding
  a column to look busier would be the kind of invented signal this page avoids.
- /demo product phone re-captured from the live demo PDP with the star/ulasan row hidden (ratings are
  on the Never-claim list): photo, gallery, title, Rp 110.000, stock, colour and size choices
  (`design/shots/sf-pdp-harga.png`).
- /cara-kerja keeps the workflow rows but with its own H2 and intro ("Setelah toko berjalan:
  pekerjaan harian.") instead of repeating the homepage's.

Pass 12 (after review round 4 = REVISE, "phone screens unreadable at 390; crops start mid-card;
imagery repeats"), owner go-ahead to generate media where it helps:
- Media decision: no generated people, products or illustrations (they would break "show the panel"
  and the Never-claim list). The motion added is real: the demo checkout captured in four states
  (`design/shots/sf-checkout-s1-kecamatan.png`, `-s3-qris`, `-s4-va`, `-s5-cod`) crossfading in the
  phone frame, CSS only (2.8s per state, frames overlap so nothing flashes), still QRIS frame under
  reduced motion. A screen recording was tried first; the only local encoder (Playwright's ffmpeg)
  cannot decode VP8, so it could not be trimmed, and stills are sharper and lighter anyway.
- Phone screens on phones are shown near 1:1 (`min(24rem, 100%)`) so their own text is readable.
- Narrow crops re-done on whole rows/cards: hero = the product list (three whole rows); editor =
  Media + Harga cards cut from the desktop capture (the panel's own phone layout overflows); bulk
  shipping = action bar, note and one whole order row; builder = the category tile row.
- Less repetition, more evidence: /pembayaran-pengiriman now shows the COD setting card
  (`design/shots/v6-pengaturan-kirim.png`) beside the COD rules and the Jasa Kirim service toggles
  beside the courier list (replacing the fourth Pengiriman Massal); /cara-kerja drops the repeated
  workflow rows for a two-line summary linking to the homepage and /fitur; signup screen larger and
  sticky beside the steps.
- Pemasaran cropped to the card's inner edge (no double outline). /demo product page re-captured with
  Khaki selected (matches "warna netral").
- Research gap closed with two screenshot-led references (Mayar, Shopify ID) above.
- Not changed: pricing includes column height (reviewer: acceptable); "Terjual 0" (real data).
- Re-rendered at 390 and 1440 (same paths as pass 8): 0 console errors, 0 overflow, one h1; the four
  checkout frames are decorative duplicates (`alt=""`, `aria-hidden`) of the described still.

Pass 13 (after review round 5 = REVISE; the 5-round cap is reached, these fixes are not re-reviewed):
- /demo product page re-captured with the sticky store header put back in flow and fixed overlays
  (chat bubble, drawer shadow) left out; the earlier full-page capture had painted the header over
  the stock line. Khaki + M selected.
- Jasa Kirim crop is now the Reguler group (eight services, SPX Standard badged COD) instead of
  Same Day / Next Day, where every row read "Tidak mendukung COD".
- Signup phone uses the full-height form (account fields down to "Sudah punya toko? Masuk"), so the
  frame has phone proportions; its "Tokomu, tayang hari ini" header stays out.
- Builder narrow = the left half of the canvas (hero headline + two tiles) at a readable scale.
- Homepage demo section shows the product page instead of the beranda already used in step 2.
- Ads screenshot capped at 56rem (close to its 876px capture). Fact-row courier line shortened;
  feature-index group "Penjualan dan pembayaran" → "Pembayaran" (one line like the others);
  `text-wrap: pretty` on running text against one-word last lines.
- Phone frame: `Screen.astro` gives phone captures a 6px dark bezel (desktop captures keep the 1px
  hairline frame). Deliberate: it marks "this is the buyer's phone" next to Seller-panel screens.
- Known, left as is: "Pilih ekspedisi lain (13)" in the checkout counts courier SERVICES for the
  route, while the page counts 10 couriers; "Rp42.7 jt" (panel summary card) and "Rp 42.674.978"
  (panel table) are the panel's own two formats of the same figure.

Pass 14 (owner 2026-10-12: ornament, type scale, footer, hover/active states; new review log):
- Rendered after the change (design/renders/home-390.png, design/renders/home-1440.png, design/renders/harga-390.png, design/renders/harga-1440.png, design/renders/fitur-390.png, design/renders/fitur-1440.png, design/renders/cara-kerja-390.png, design/renders/cara-kerja-1440.png, design/renders/bayar-kirim-390.png, design/renders/bayar-kirim-1440.png, design/renders/demo-390.png, design/renders/demo-1440.png): 0 console errors, 0 overflow, one h1 per page.
- Golden-spiral ornament visible but quiet: behind the hero screenshot (anchored to the content
  edge; an earlier placement on the bleeding screenshot pushed the page 32–85px sideways and was
  moved), in the right half of /fitur's intro, mirrored in the closing band, and low on the left of
  the pricing ink band. Below 1024px only the hero and pricing ones remain.
- Hero headline was five lines at the new display size beside the screenshot: capped at 3.15rem and
  the copy column widened 11fr → 12fr; now three lines at 1440.
- Footer: dark band flush with the viewport bottom at 390 and 1440, four columns → 3 → 2; "Masuk seller"
  keeps the Akun column on one line per link.
- Current page in the header reads as a full-strength bar under "Fitur" on /fitur; hover shows the
  same bar at 40%.

