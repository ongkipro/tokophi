# Akun TokoΦ — design record (`apps/account`)

Product contract: `specs/docs/TOKOPHI_ACCOUNT_SPEC.md` §18. Token and component anatomy:
`prototypes/tokophi-account/DESIGN.md` (Seller-aligned, OKLCH indigo 277, Geist). This file does not
define tokens; it records how the accepted prototype is carried into the real app and the evidence.

## Audience, task, surface

- **Buyer** (Indonesia, phone-first, 390 px): find an order again, see what happens next, reach the
  shop, keep addresses. Surface: customer portal.
- **Affiliate** (same person, same account): see every store they promote, what is payable and when,
  share their link. Surface: customer portal, ledger-heavy.
- Owner direction 2026-10-16: use the prototype; same UI/UX for affiliate, different content and nav.

## Reference evidence

Accepted project reference: the local prototype (`prototypes/tokophi-account`, served at `:4187`),
captured 2026-10-16 with Playwright/Chrome after the demo sign-in, images opened and inspected:

- `design/refs/prototype/1440_dashboard.png` — desktop shell: 256 px sidebar with brand row, identity
  card, nav with indigo-tinted active item; 64 px topbar with context label, theme + avatar; content
  column centred, action cards first (pay, shipping), then 4 stat tiles, then two columns
  (recent orders | vouchers + help).
- `design/refs/prototype/1440_account.png` — two-column profile grid of section cards
  (personal info, security & devices, addresses | notifications, connected stores, data).
- `design/refs/prototype/1440_orders.png`, `design/refs/prototype/390_orders.png` — search + store
  select toolbar, segmented status filter, result count, order cards: thumbnail, store, status badge,
  date + first line, total, next-step link on a divided footer row.
- `design/refs/prototype/390_orders_PHI-202865413Q8M.png` — status-first detail: human status as H1,
  store · number · date meta, summary card with total, badge, primary + secondary action, section
  links (Pembayaran/Pengiriman/Bukti pesanan), product card, address card with the snapshot note,
  totals card.
- `design/refs/prototype/390_dashboard.png` — phone: brand topbar, 2×2 stat grid, 5-item bottom bar
  with indigo active item and underline.

Transfer rationale: the prototype was already reviewed against the Seller dashboard (owner accepted
its geometry, §16 evidence) and the owner chose it explicitly; the app keeps its anatomy and tokens
and only removes elements without data (spec §18.5).

## Composition contract

- **C1** Desktop ≥ 1024 px: full-bleed grid `256px | 1fr`, rows `64px | 1fr`; sidebar pinned left,
  sticky at viewport height, spans both rows with brand row (64 px), identity card, nav; sticky topbar
  across the rest with its content aligned to the content column; content max 1120 px centred in the
  area beside the sidebar, 24 px padding. (Owner 2026-10-16 replaced the prototype's 1200 px centred box.)
- **C2** < 1024 px: sidebar hidden; sticky 60–64 px topbar with wordmark + "Akun"/"Affiliate", theme,
  avatar; fixed 5-item bottom bar (64 px + safe area), active = indigo label + 24×3 px underline.
- **C3** Page header: H1 24/32 semibold, lead 14 px muted; no eyebrow, no emoji.
- **C4** Order detail is status-first: H1 = human status; summary card (total 28–32 px, badge,
  actions) precedes content sections; desktop puts summary/actions in a right column (`detail-grid`
  1.5fr | 1fr).
- **C5** Lists of comparable items (orders, commissions, stores) are repeated cards or divided rows
  with the same anatomy; stat tiles up to four across on desktop (only tiles with data render: three for
  an affiliate, two otherwise), 2×2 phone with an odd last tile spanning the row.
- **C6** Section cards sit on the canvas; never card-in-card; 1 px border, radius 10, shadow-xs.
- **C7** Badges are pill capsules with tinted background per state; amounts, dates, AWB, order
  numbers use tabular numerals.
- **C8** Workspace switch (affiliate accounts only): segmented control under the identity card on
  desktop, at the top of content on phones. Affiliate nav: Ringkasan, Komisi, Program, Gabung, Akun.

**Do not substitute:** the old 2026-10-15 app styles (Φ tile header, "card" blocks around everything,
top tab nav), a generic SaaS bento, eyebrow kickers, decorative illustrations, fabricated product
photos (use `product_media` or the neutral package icon).

## Theme

Light + dark both designed (prototype tokens). Order: stored choice (`tphi_theme`) → system. The
topbar toggle stores light/dark; the Akun page offers Terang / Gelap / Sistem.

## Render critique

Author: claude/claude-opus-5-5 (builder; round 6 revision: claude/claude-sonnet-5-5)

Macro pass (2026-10-16, shell only, dev server): `design/renders/` did not exist yet; the first shell
render showed the prototype geometry intact (sidebar 256, topbar 64, centred content) and one defect —
the phone topbar sat 40 px low (a `top: 40px` left from the removed prototype banner); fixed in
`prototype.css` before any page work.

Final pass (2026-10-16, every page, decoded and opened):

- `design/renders/1440_.png` — Beranda follows C1/C5: four stat tiles, recent orders as repeated
  cards with real thumbnails (one order has no photo → neutral package icon, not a fabricated image),
  Bantuan list on the right, "Beli lagi" without a price promise. No action card shows because Rina
  has no unpaid or shipped order — correct, not a gap. Workspace switch sits under the identity card (C8).
- `design/renders/390_.png`, `design/renders/390_orders.png` — phone: switch at the top of content,
  2×2 tiles, bottom bar with indigo active item (C2). Search/toko/status toolbar wraps without overflow.
- `design/renders/390_orders_PHI-713020233OA7.png` — status-first detail (C4): H1 "Sedang diproses",
  summary card with total and primary WhatsApp action, section links, payment/shipping key-value panels,
  progress steps without invented events, totals add up (Biaya COD row). Two product thumbnails are
  blank in this full-page capture only: they are `loading="lazy"` below the fold; a scrolled run
  confirmed all three load (naturalWidth 600). The key-value panels are tinted, not bordered cards, so
  C6 (no card-in-card) holds; kept as the prototype draws them.
- `design/renders/1440_orders_PHI-713020233OA7.png` — detail-grid two columns, right column not
  stretched.
- `design/renders/1440_affiliate_komisi.png` — affiliate workspace: same shell, different nav
  (Ringkasan · Komisi · Program · Gabung · Akun), ledger as a table on wide screens, state badges with
  dates, filter tabs as links. Order numbers in monospace are data identifiers, not decorative labels.
- `design/renders/390_affiliate.png` — Ringkasan on a phone: hero tile + two tiles, H+3 explanation,
  programme cards with share link + copy.
- `design/renders/1440_account.png`, `design/renders/390_addresses.png`, `design/renders/390d_account.png`,
  `design/renders/390d_affiliate_komisi.png` — profile grid per the prototype; dark theme keeps contrast
  on badges and tiles.

Revision after independent review round 1 (REVISE, 2026-10-16) — fixed and re-rendered
(`design/renders/*` recaptured after `networkidle`, cursor moved off the page):
- Product thumbnails: `ProductThumb` draws the package icon under every photo, so a missing, slow or
  failed image never leaves an empty square; detail/Beranda load eagerly. Verified in
  `design/renders/1440_orders_PHI-713020233OA7.png` (3 photos + 2 icons).
- Detail: duplicate status badge removed (H1 carries it); phone section links are one scrolling chip
  row; progress = filled done, indigo ring current, hollow light pending; titles medium weight, 2 lines.
- Orders list phone (`design/renders/390_orders.png`): search + store + icon button on one row
  (sr-only labels kept — placeholders are never the only label), status tabs one scrolling line.
- Beranda: Beli lagi store name one muted line; arrows dropped from tiles; the indigo first card was
  the capture tool's hover, now also disabled on `hover: none` devices.
- Akun (`design/renders/1440_account.png`): "Perangkat ini" + one summary row for other devices with
  a collapsed per-device list; Toko/Alamat/Affiliate merged into one "Terhubung" card.
- Alamat: Hapus separated as a destructive text link at the row end.
- Komisi (`design/renders/1440_affiliate_komisi.png`): store filter as link chips (no select +
  Terapkan), filtered totals as three tiles, stacked on phones; Ringkasan tiles share a baseline;
  share link keeps `?ref=CODE` visible.
- Shell: identity card shows the email instead of a third "Akun pembeli"; dark secondary buttons sit
  above the card tone.
Revision after review round 2 (REVISE) — re-rendered; the capture tool now waits for `networkidle`
and `img.decode()` (round 2's phone shot had raced image decoding; a live probe showed all photos
displayed):
- `design/renders/390_orders_PHI-713020233OA7.png` — 3 photos + 2 package icons at phone width; plain
  divided key-value rows on the card surface (no tinted inner box, C6); "Jumlah" dropped when equal to
  "Total dibayar"; section chips bordered with a right-edge fade.
- `design/renders/1440_.png` — tile links indigo again; "Beli lagi" moved under Bantuan as a compact
  list (no truncated store label), columns balanced.
- `design/renders/1440_orders.png`, `design/renders/390_orders.png` — desktop list now supplied;
  phone search/select/button share one 44 px row; status tabs fade at the edge.
- `design/renders/1440_account.png` — "Lihat perangkat" is a text link with chevron; columns balanced;
  127 leftover demo sessions from capture runs revoked on the branch DB (seed artefact, not design).
- `design/renders/1440_affiliate_komisi.png`, `design/renders/390_affiliate.png` — store chips and
  state tabs in one toolbar row on desktop, compact totals; "Gabung program toko lain" moved below the
  programme list.

Revision after review round 3 (REVISE minor) — full render set recaptured, now including desktop
dark (`1440d_*`) and the screens round 3 found missing:
- `design/renders/390_affiliate_komisi.png` — totals in one compact three-column row; first two
  commissions above the fold at 390×844. Trade-off recorded: chip rows here are 38 px tall (above the
  WCAG 2.2 24 px target, below the 44 px house baseline) to keep the ledger above the fold.
- `design/renders/1440_affiliate.png`, `design/renders/390_affiliate.png` — share link shows host +
  bold `ref CODE`; copy still yields the full URL.
- `design/renders/1440_orders_PHI-713020233OA7.png` — section chips hidden ≥1024 px; key-value
  labels 13 px muted (4.74:1 light, 6.94:1 dark measured); "Bukti pesanan" secondary style.
- `design/renders/1440_.png`, `design/renders/390_orders.png` — no "→" glyphs; Bantuan rows end in
  a chevron icon; buyer scroll/fade rules scoped to `.buyer-tabs`/`.detail-chips` (they had leaked onto
  the Akun Tampilan control).
- `design/renders/1440_account.png`, `design/renders/390d_account.png` — "Keluar dari akun" is a
  normal-width red text button; Tampilan control has no fade; Hapus on Alamat has a 44 px tap area
  (`design/renders/390_addresses.png`).
- Newly covered: `design/renders/1440d_stores_batiknusantara.png` (store profile, dark),
  `design/renders/1440_affiliate_program.png`, `design/renders/390_affiliate_gabung.png`,
  `design/renders/390_tidak-ada.png` (404 inside the shell), `design/renders/1440d_.png`.

Revision after review round 4 (REVISE) + owner direction 2026-10-16 ("terlalu ada gap sidebar dan
sticky") — full render set recaptured:
- Shell full-bleed (C1 amended by the owner, and as the prototype README already recorded: "Header and
  canvas continue across that area"): sidebar pinned to the left edge, sticky at viewport height, its
  column painted by the shell so it reaches the bottom of long pages; sticky topbar across the rest,
  its content aligned to the 1120 px content column. `design/renders/1440_.png`,
  `design/renders/1440d_orders_PHI-713020233OA7.png`.
- Last order card in each stack had lost its bottom border (an old list-row rule); restored.
- Dark indigo measured 2.90:1 on cards (the prototype never applied a dark primary): dark `--primary`
  is now oklch(0.68 0.17 277) with dark ink on filled buttons (5.97:1 text, 6.60:1 button); avatar
  initials 6.82:1; `--destructive-foreground` defined (4.56:1 / 6.84:1). Every pair on every page
  measured ≥ 4.5:1 in both themes by the three tracks with `contrast.py`.
- Beli lagi rows are whole-row links (`design/renders/390_.png`); order-detail actions sit under the
  total on desktop; store profile privacy note is a plain muted note
  (`design/renders/1440d_stores_batiknusantara.png`); recipient names in normal ink.
- Affiliate: `design/renders/1440_affiliate_program.png` carries each programme's real figures (base
  rate, hold, orders, ready/held/paid); Ringkasan tile arrows gone; Gabung field has an example.

Revision after review round 5 (REVISE) — full render set recaptured (`design/renders/*`):
- `design/renders/1440_orders_PHI-713020233OA7.png` — the summary no longer spans the left column
  (C4): sections left; total + actions, totals and help in the right column (explicit grid placement,
  `grid-template-rows: auto 1fr`).
- `design/renders/1440_.png` — with nothing to pay or track, the one moving order gets a status strip
  above the tiles. `design/renders/390_orders_PHI-713020233OA7.png` — product titles clamp at three lines.
- `design/renders/1440_stores_batiknusantara.png` — "Putuskan" is a red text-link, not a filled card button.
- Already in place from earlier rounds and re-checked: 18 px wordmark, muted affiliate tile notes,
  "namatoko" placeholder, 44 px phone toolbar controls. Komisi on a phone keeps two scrolling chip rows
  (store, state): different dimensions, kept apart on purpose.

Not adopted: replacing field labels with placeholders (accessibility rule: placeholders never replace
labels); the reviewer's "dead void" under Bantuan stays (no data for the prototype's voucher column).

Revision after review round 6 (REVISE; log cleared by the owner's "sempurnakan", rounds 1–5 archived in
`design/review-rounds.log.archived-1-5`, the round-5 verdict in `design/review-round5.md`) — full render set
recaptured, now including the screens the reviewer said were never rendered:
- `design/renders/1440_.png`, `design/renders/390_.png` — the status strip's action is an indigo primary;
  the "Alamat tersimpan" count tile is gone (the sidebar and Bantuan already link there) and "Komisi siap
  dibayar" carries the accent, so the one money figure outranks the counts. Next-step labels on order
  cards are indigo links, and section headings share one height so Bantuan lines up with Pesanan terbaru.
- `design/renders/1440_orders.png`, `design/renders/390_orders.png` — search, native select and button are
  one height and font (40 px desktop, 44 px phone); the select's chevron is our own.
- `design/renders/1440_orders_PHI-713020233OA7.png`, `design/renders/390_orders_PHI-713020233OA7.png` —
  the right column follows the reader (`position: sticky`) and the dead gap under the total is closed; the
  totals' values are normal ink; an order in `diproses`/`dikirim` leads with Pengiriman (CSS `order`, the
  DOM and focus order are unchanged and the only controls in the two cards are a copy button and links).
  `design/renders/390d_orders_PHI-713020233OA7.png` — dark pending ring raised to a visible contrast.
- `design/renders/1440_stores_batiknusantara.png`, `design/renders/1440d_stores_batiknusantara.png` — the
  privacy note is the footer of "Riwayat dengan toko ini"; unlinking is one quiet text row that opens its
  confirmation in place.
- `design/renders/1440_account.png` — "Buka Affiliate" replaces the ambiguous "Buka".
- `design/renders/1440_affiliate.png`, `design/renders/1440d_affiliate.png` — "Siap dibayar" is the hero
  tile on desktop (1.5fr + two smaller).
- `design/renders/390_affiliate_gabung.png`, `design/renders/1440_affiliate_gabung.png` — the helper is one
  line; the "Diundang seller?" card now has its action ("Lihat undangan saya").
- Newly rendered, was uncovered: sign-in and claim while signed out (`design/renders/390_keluar_masuk.png`,
  `design/renders/1440_keluar_masuk.png`, `design/renders/390_keluar_klaim_t_tidak-sah.png`,
  `design/renders/1440_keluar_klaim_t_tidak-sah.png`), address form (`design/renders/390_addresses_edit.png`,
  `design/renders/1440_addresses_edit.png`), affiliate programme detail and invitations
  (`design/renders/1440_affiliate_undangan.png`, `design/renders/390_affiliate_undangan.png`), receipt, the
  stores list, and empty states for a second account with nothing saved
  (`design/renders/390_kosong_.png`, `design/renders/1440_kosong_.png`, `design/renders/390_kosong_orders.png`,
  `design/renders/390_kosong_stores.png`, `design/renders/390_kosong_addresses.png`,
  `design/renders/390_kosong_affiliate.png`; dark counterparts `390d_*`/`1440d_*`).
- Also covered: `design/renders/390_affiliate_e5d9b39c-8605-4581-89a2-477089f18bef.png` (programme detail),
  `design/renders/1440_orders_PHI-713020233OA7_receipt.png` (receipt), `design/renders/390_stores.png`.
- Local sign-in has no Google button because the dev server carries no Google client; production shows it.

Revision after review round 7 (REVISE, smaller findings; the log now holds 2 rounds) — render set recaptured:
- `design/renders/1440_affiliate.png` — the round-6 note claimed a hero tile that the render did not show:
  `affiliate.css` (loaded after `buyer.css`) still said three equal columns. Fixed at the source (1.5fr + two),
  so the claim is now true. `design/renders/1440_affiliate_program.png` — "Siap dibayar" carries the accent.
- `design/renders/390_.png` — an odd last tile spans the row; `design/renders/390_kosong_.png` — the empty
  state is one left-aligned block.
- `design/renders/390_stores.png` — the "Pesanan terakhir" label is sentence case (C3: no eyebrow).
- `design/renders/390_orders_PHI-713020233OA7.png` — completed steps no longer print "Sudah" (state is derived
  from status; there is no timestamp to show — screen-reader text says "Selesai"); the AWB and "Salin" stay on
  one line; the section chips sit directly under the summary. `design/renders/1440_orders_PHI-713020233OA7_receipt.png`
  — the receipt is centred in the column.
- `design/renders/1440_addresses_edit.png` — "Kode pos" is labelled "(wajib)".
- `design/renders/1440_affiliate_undangan.png` — the dead-end card offers "Gabung program toko" first.
- Not changed: the phone workspace switch stays on every page (the accepted prototype carries it there);
  Komisi's chip rows keep their current grouping. The production Google button cannot be captured locally
  (no Google client on the dev server); it is unverified here and said so.

Revision after review round 8 (REVISE; log at 3 of 5) — render set recaptured, and the capture now scrolls the
page first so lazy images load (the "photo in one capture, icon in another" thumbnails were that artefact):
- Two CSS rules added in rounds 6–7 leaked past their screens. The odd-tile rule and the desktop hero made the
  phone Ringkasan tiles three different widths and broke "6 komisi" into "komis/i" in Komisi's totals. Both are
  scoped now: hero only at ≥901 px and not on Komisi's totals; the odd-tile rule only on Beranda.
  `design/renders/390_affiliate.png`, `design/renders/390_affiliate_komisi.png`, `design/renders/390d_affiliate_komisi.png`.
- `design/renders/1440_orders_PHI-713020233OA7.png` — a delivered order's last step is filled green ("Selesai"),
  not a hollow "Saat ini" ring. `design/renders/390_orders_PHI-713020233OA7.png` — the resi keeps its own line
  and "Salin" wraps under it. `design/renders/1440_stores_batiknusantara.png` — the unlink row aligns to the card's
  inner padding. `design/renders/390_affiliate_komisi.png` — the chip rows fade at the right edge.
- Decision, not a defect: opening `/klaim?t=…` signed out goes to sign-in with the token kept in `next`
  (`design/renders/390_keluar_klaim_t_tidak-sah.png` therefore shows sign-in); the refusal text appears after
  sign-in, where the token can be checked against the account. Saying "invalid" before sign-in would tell an
  anonymous visitor whether a token verifies.
- Not changed (subjective, recorded): Beranda column bottoms, Akun column heights, the Alamat form width,
  the dark segmented switch's active label (the round-4 contrast pass measured it ≥ 4.5:1; not re-measured in this round).

Revision after review round 9 (REVISE; log at 4 of 5) — render set recaptured:
- `design/renders/1440_orders_PHI-713020233OA7_receipt.png` — order numbers use one face (the receipt header
  was monospace, the body sans) and a slashed zero, so "0" and "O" differ.
- `design/renders/390_stores.png` — the last-order note is a plain block, no card inside the store card (C6).
- `design/renders/390_keluar_masuk.png` — the root carries the canvas colour, so the short sign-in page has no
  white strip under it. `design/renders/1440_affiliate_undangan.png` — the dead-end card is left-aligned.
- Contract C5 now says what the app does (tiles only where there is data).
- Coverage the reviewer listed as missing already existed and is cited here: light phone Akun
  `design/renders/390_account.png`, desktop Alamat list `design/renders/1440_addresses.png`, dark desktop Akun
  `design/renders/1440d_account.png` and Program `design/renders/1440d_affiliate_program.png`.
- Not changed: the unlink row stays below the card (rounds 5–8 moved it twice; it is one quiet text row),
  Beranda's strip beside the same order's card (the strip is the action, the card is the history),
  Komisi's two chip rows (faded; a dropdown would hide the options), the share link truncation at 390 px
  (the code is on the row above).

Not adopted in round 6: external order-tracking research (Shopee/Tokopedia) as a transfer rationale — the
owner's accepted prototype is the reference by decision, recorded above; Komisi's two chip rows on a phone
stay two rows (store and state are different dimensions).

Revision after review round 10 (REVISE; log at 5 of 5 — cap reached, nothing further reviewed): the empty-state
card on Beranda was still centred above a left-aligned list, contradicting the round-7 note. Cause: `.state-card` is a
flex column with `align-items: center`; it now stretches and its heading and lead are left-aligned
(`design/renders/390_kosong_.png`, `design/renders/1440_kosong_.png`). This last change is not re-reviewed.
Open reviewer findings are listed in `BUILD-LOG.md` (2026-10-18) and `design/review.md`.

Revision after the market review (2026-10-19, spec §19; after the review cap, so none of this is reviewed): Beranda no longer repeats the strip's order and "Bantuan" is "Pintasan" (`design/renders/1440_.png`); a delivered order leads with Produk, "Bukti pesanan" is its primary action and the step list is one line (`design/renders/1440_orders_PHI-713020233OA7.png`); Akun gained "Tutup akun" (`design/renders/390_account.png`, `design/renders/1440_account.png`).

Remaining trade-offs: the bottom bar appears mid-page in full-page phone captures (it is `position:
fixed`; on a device it stays at the bottom). Seed product images are served from the production
storefront host (public assets; no personal data).

## Acceptance evidence

- `npx astro check` (apps/account): 0 errors, 0 warnings (56 files).
- `vitest run apps/account`: 6 files, 40 tests passed (real Postgres, branch test DB).
- `astro build` OK; `scripts/check-ui.mjs` against the build (`NODE_ENV=production`, port 4339):
  18 routes × 7 viewports (360/390/768/1024/1440 light, 390/1440 dark) — no non-200, no sideways
  scroll, one h1 each, every control labelled, every image with alt, no console error, skip link first;
  negative sweep: budi → 404 on 5 of Rina's records. Sanity: run with the same account as "other" → FAIL 5.
