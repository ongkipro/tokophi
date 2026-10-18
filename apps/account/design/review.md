Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: design/renders/1440_.png, design/renders/1440_account.png, design/renders/1440_addresses.png, design/renders/1440_addresses_edit.png, design/renders/1440_affiliate.png, design/renders/1440_affiliate_gabung.png, design/renders/1440_affiliate_komisi.png, design/renders/1440_affiliate_program.png, design/renders/1440_affiliate_undangan.png, design/renders/1440_keluar_klaim_t_tidak-sah.png, design/renders/1440_keluar_masuk.png, design/renders/1440_kosong_.png, design/renders/1440_orders.png, design/renders/1440_orders_PHI-713020233OA7.png, design/renders/1440_orders_PHI-713020233OA7_receipt.png, design/renders/1440_stores_batiknusantara.png, design/renders/1440d_.png, design/renders/1440d_account.png, design/renders/1440d_affiliate.png, design/renders/1440d_affiliate_program.png, design/renders/1440d_orders_PHI-713020233OA7.png, design/renders/1440d_stores_batiknusantara.png, design/renders/390_.png, design/renders/390_account.png, design/renders/390_addresses.png, design/renders/390_addresses_edit.png, design/renders/390_affiliate.png, design/renders/390_affiliate_e5d9b39c-8605-4581-89a2-477089f18bef.png, design/renders/390_affiliate_gabung.png, design/renders/390_affiliate_komisi.png, design/renders/390_affiliate_undangan.png, design/renders/390_keluar_klaim_t_tidak-sah.png, design/renders/390_keluar_masuk.png, design/renders/390_kosong_.png, design/renders/390_kosong_addresses.png, design/renders/390_kosong_affiliate.png, design/renders/390_kosong_orders.png, design/renders/390_kosong_stores.png, design/renders/390_orders.png, design/renders/390_orders_PHI-713020233OA7.png, design/renders/390_stores.png, design/renders/390_tidak-ada.png, design/renders/390d_account.png, design/renders/390d_affiliate_komisi.png, design/renders/390d_orders_PHI-713020233OA7.png
References: design/refs/prototype/1440_account.png, design/refs/prototype/1440_dashboard.png, design/refs/prototype/1440_orders.png, design/refs/prototype/390_dashboard.png, design/refs/prototype/390_orders.png, design/refs/prototype/390_orders_PHI-202865413Q8M.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 0fb0c07b463fb496
Images-SHA: 8f784924dd624ec1
Output-SHA: 98c89f5527b49cce

All 73 images opened and inspected (one path I mistyped on the first try, `390_stores-01.png`, was re-read from the correct path). Twelve of them are not the app. `75deec…1440_account`, `74a5e…1440_dashboard`, `96eb1…1440_orders`, `dd0040…390_dashboard-01..03`, `670261…390_orders-01/02` and `57b2dc…390_orders_PHI-202865413Q8M-01/02` are prototype reference captures. They show "Sari Andini", a "Mode Uji Coba Lokal" banner and a notification bell. I used them as the reference role. Several trailing slices are blank or near-blank page tails: `390_-03`, `390_orders_PHI-713020233OA7-04`, `390d_…-04`, `390_kosong_-02`, `390_addresses-02`, `390_orders-02`. They are not defects.

## Per section (top to bottom)

**Shell (all screens)**
- Sidebar, identity card, workspace switch | authored (Seller-aligned portal, Φ wordmark, indigo active pill) | matches the reference skeleton: 256 px rail, identity card, tinted active item, no eyebrow | On phone the Belanja/Affiliate switch sits above every page, including the Alamat form and order detail (`390_addresses_edit-01`, `390_orders_PHI-…-01`). Show it only on Beranda and Akun.
- Phone bottom bar | authored | matches (5 items, indigo label plus underline) | Gabung takes a permanent slot for a one-time action. Program already has a "Gabung program toko" button, and Ringkasan has "+ Gabung program toko lain". Fold Gabung into Program and use the slot for Akun-level items.

**Beranda** (`1440_-01`, `390_-01/02`, `1440d_-01`)
- Status strip | authored | partly matches. The reference uses orange/blue urgency cards, while the app has one pale-indigo strip | The strip and the first order card below it describe the same order. Drop the order from the list while the strip is showing it.
- Three stat tiles | generic-leaning (title, big number, link) but justified, because the data differs and the accent is on money | matches in spirit; the reference has four tiles with "→" and the app dropped both | "Toko terhubung 1" carries no decision. Fold it into the Toko nav item and give the width to "Komisi siap dibayar".
- Pesanan terbaru and Bantuan | authored | matches | "Simpan pesanan lain ke akun" and "Keluar dari perangkat lain" are settings shortcuts under a "Bantuan" heading. Rename it "Pintasan".
- Beli lagi (three products, no price) | authored, real thumbnails | the reference shows price plus a Beli Lagi button | A bare row is fine. Add a price, or the click target says nothing.

**Pesanan list** (`1440_orders-01`, `390_orders-01`)
- Toolbar, tabs, repeated order cards | authored; repeating one anatomy for comparable items is correct | matches | The first order has a package icon where the other two show photos. That is the honest fallback, but the whole list reads uneven. This is data, not layout.

**Order detail** (`1440_orders_PHI-…-01`, `390_orders_PHI-…-01..03`, dark variants)
- H1 and summary card | authored; status-first | matches the reference C4 | A delivered order's primary action is the indigo "Hubungi Batik Nusantara". Make "Bukti pesanan" or "Beli lagi" the primary for `selesai`.
- Contact actions | generic duplication | none in the reference | Three contact paths for one store sit on one screen: "Hubungi…", "WhatsApp Batik Nusantara" and "Kunjungi toko" in "Butuh bantuan?". Keep one.
- Section order | authored | partly | For a completed order, Pembayaran, Pengiriman and Produk are stacked in that order, so "what did I buy" is the fourth block (y≈975). Lead with Produk for `selesai`, as is already done for Pengiriman on `diproses`.
- Timeline | authored | matches | Four green nodes with no timestamps add little on a finished order. Collapse to one "Selesai" line when all steps are done.
- Pembayaran card | authored | matches | It has about 40 px of dead padding at the bottom (`1440_orders_PHI-…-01`, y≈400–437). Trim it.
- Phone: chips row | authored | matches | There is about 60 px of empty space between the chip row and the first card (`390_orders_PHI-…-01`, y≈598–648). Tighten it.

**Bukti pesanan** (`1440_…_receipt-01`)
- Centred document | authored | none needed | The footer disclaimer is about 11 px and low contrast. Raise it to 12–13 px.

**Toko** (`1440_stores_batiknusantara-01`, `390_stores-01`, dark)
- Header card, history list, "Riwayat" card | authored | matches | "Putuskan Batik Nusantara" is a red underlined link floating below the right card, indented from it. It reads as orphaned. Put it inside the card footer or align it to the card edge.

**Akun** (`1440_account-01`, `390_account-01/02`, dark)
- Two-column section cards | authored | matches | The "Terhubung" card repeats the sidebar's Toko, Alamat and Affiliate as three small buttons. Keep only the privacy note and the affiliate row.
- Phone | authored | n/a | "Keluar dari akun" is not visible in either phone slice (`390_account-01` ends at "Lihat perangkat", `-02` starts at "Terhubung"). I could not inspect that region.

**Alamat** (`1440_addresses-01`, `1440_addresses_edit-01`, `390_addresses*`)
- List | authored | matches | Fine.
- Form | authored | none | Four of the six fields carry helper text, and Kecamatan has both a type-ahead and a "Cari" button. Keep helpers only where the shopper can go wrong: Kode pos and Kecamatan.

**Affiliate** (`1440_affiliate-01`, `1440_affiliate_komisi-01`, `1440_affiliate_program-01`, `390_affiliate*`)
- Ringkasan tiles | authored | n/a (no reference equivalent) | The hero "Rp 129.200" is black here but indigo on Beranda. Use one treatment for the money figure.
- Programme cards and share link | authored | n/a | Monospace on the code (`RINA10`) is a data identifier and is fine.
- Ringkasan vs Program | duplicated | n/a | Both list the same two programmes with overlapping figures. Fine as drill-down, but see the Gabung note above.
- Komisi table | authored | n/a | **Order numbers are monospace here (`PHI-4980`, `DEMO-AFF-1`) but sans in Pesanan, the detail and the receipt (`PHI-641355083NMN`).** One identifier, two faces. Pick one.
- Phone Komisi | authored | n/a | Two scrolling chip rows plus a totals row before the first row is heavy. That trade-off is already recorded, so I am not re-opening it.

**Sign-in and claim** (`1440_keluar_masuk-01`, `390_keluar_masuk-01`, `…_klaim_t_tidak-sah`)
- Value list and form card | mostly authored | matches the contract | Three checkmark bullets are the one visible template signal. Cut to a single sentence, since the heading already says it.
- Phone | n/a | n/a | In both `390_keluar_*` slices a lighter band shows below y≈805. The round-9 note says the canvas colour was fixed. I can see a strip, which may be a capture artefact, but it is not confirmed fixed.

**Empty states** (`390_kosong_*`, `1440_kosong_-01`)
- "Simpan pesanan pertama" | authored | n/a | Heading and lead are centred while the numbered list is left-aligned, with a blank band in between. This contradicts the round-7 note "one left-aligned block". Left-align the whole card.
- Sidebar "Jadi affiliate" promo | authored | n/a | It is desktop only. `390_kosong_-01` has no route to affiliate for a non-affiliate on a phone.

**404** (`390_tidak-ada-01`) | authored | n/a | Fine.

**Dark** (`1440d_*`, `390d_*`) | authored | matches the contract | The timeline's neon green rings are the loudest element on `390d_orders_PHI-…-02`. Lower their chroma.

## Reference comparison
The references (Sari Andini set) show the sidebar and topbar skeleton, action cards, a tile row, a two-column body, a status-first detail with a chip row, and a phone bottom bar. The renders keep all of that. They drop the reference's top banner, the `MENU UTAMA` eyebrow, the `→` glyphs, the notification bell, the nav count badge, the voucher block and the checkbox panel. This matches the contract's "remove what has no data" and "no eyebrow". The full-bleed shell replaces the reference's centred 920 px box, which is an owner-recorded change.

Two mismatches:
- The reference has urgent states (`Perlu Tindakan` pay-now card, `Sedang Dikirim` with resi, `Menunggu pembayaran`, `Dibatalkan`, `Pengembalian`) that the app set never renders. The app images show only `diproses` and `selesai`. I cannot judge how the pay-now strip, `dikirim` with a resi, or cancelled and returned orders look in the app.
- The reference's urgent cards use orange tint for urgency. The app has one pale-indigo strip. That needs a `belum bayar` render to judge.

The transfer rationale is present: the DESIGN.md lists observations per reference image, and the owner-accepted prototype is the stated reference. There is no external marketplace research. The record says that was deliberate, so I am not treating it as a defect. The "familiar pattern" is justified by the user job (find the order, see what happens next, reach the shop). The page is still a generic portal and would fit an unrelated business if the name were swapped. For a utility surface that is acceptable. No gradient headline, dark-navy hero or tracked eyebrow is present.

Most important change: render and fix the states the app set never shows (unpaid order with pay action, shipped order with pending resi, cancelled or returned order), and cut the three duplicate store-contact actions on order detail so the one primary action matches the order's state.

Verdict: REVISE