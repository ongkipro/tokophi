Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: design/renders/1440_.png, design/renders/1440_account.png, design/renders/1440_addresses.png, design/renders/1440_addresses_edit.png, design/renders/1440_affiliate.png, design/renders/1440_affiliate_gabung.png, design/renders/1440_affiliate_komisi.png, design/renders/1440_affiliate_program.png, design/renders/1440_affiliate_undangan.png, design/renders/1440_keluar_klaim_t_tidak-sah.png, design/renders/1440_keluar_masuk.png, design/renders/1440_klaim_t_tidak-sah.png, design/renders/1440_kosong_.png, design/renders/1440_orders.png, design/renders/1440_orders_PHI-713020233OA7.png, design/renders/1440_orders_PHI-713020233OA7_receipt.png, design/renders/1440_stores_batiknusantara.png, design/renders/1440d_.png, design/renders/1440d_account.png, design/renders/1440d_affiliate.png, design/renders/1440d_affiliate_program.png, design/renders/1440d_orders_PHI-713020233OA7.png, design/renders/1440d_stores_batiknusantara.png, design/renders/390_.png, design/renders/390_account.png, design/renders/390_addresses.png, design/renders/390_addresses_edit.png, design/renders/390_affiliate.png, design/renders/390_affiliate_e5d9b39c-8605-4581-89a2-477089f18bef.png, design/renders/390_affiliate_gabung.png, design/renders/390_affiliate_komisi.png, design/renders/390_affiliate_undangan.png, design/renders/390_keluar_klaim_t_tidak-sah.png, design/renders/390_keluar_masuk.png, design/renders/390_klaim_t_tidak-sah.png, design/renders/390_kosong_.png, design/renders/390_kosong_addresses.png, design/renders/390_kosong_affiliate.png, design/renders/390_kosong_orders.png, design/renders/390_kosong_stores.png, design/renders/390_orders.png, design/renders/390_orders_PHI-713020233OA7.png, design/renders/390_stores.png, design/renders/390_tidak-ada.png, design/renders/390d_account.png, design/renders/390d_affiliate_komisi.png, design/renders/390d_orders_PHI-713020233OA7.png
References: design/refs/prototype/1440_account.png, design/refs/prototype/1440_dashboard.png, design/refs/prototype/1440_orders.png, design/refs/prototype/390_dashboard.png, design/refs/prototype/390_orders.png, design/refs/prototype/390_orders_PHI-202865413Q8M.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: a937f9b43e972d35
Images-SHA: 62f657d961b01204
Output-SHA: 57e990410d235295

# Visual review: Akun TokoΦ (`apps/account`)

I opened all 73 images and none failed to load. The last six slices (`75deec…-1440_account`, `74a5e1…-1440_dashboard`, `96eb1b…-1440_orders`, `dd0040…-390_dashboard`, `670261…-390_orders`, `57b2dc…-390_orders_PHI-202865413Q8M`) are the prototype reference, so I compared against them directly. Some slices are partial crops. "Slice-02" views like `390_addresses-02` and `390_kosong_-02` are nearly blank strips of page tail. I judged the page from the first slice of each route.

## Section by section

**Shell, desktop** (every `1440_*`) | authored | prototype geometry matches: 256 px sidebar, 64 px topbar, indigo-tinted active item, identity card, segmented Belanja/Affiliate switch | The sidebar is empty below the nav on every page. For accounts without affiliate (`1440_kosong_`) the nav starts 46 px higher than for Rina, so the shell shifts between accounts. Reserve the switch row, or accept the shift deliberately.

**Shell, phone** (every `390_*`) | authored | matches the reference (`dd0040…390_dashboard`): wordmark topbar, 5-item bottom bar with indigo label and underline | The Belanja/Affiliate switch costs about 65 px at the top of every screen. That includes the address form (`780ed9…-01`), the claim refusal and the 404 (`2da1b8…`), where it adds nothing. It should appear only on Beranda/Ringkasan and Akun.

**Beranda, desktop** (`a4fa2b…1440_-01`, dark `7c05aa…`) | authored | prototype order (action card, tiles, two columns) is kept and thinned to what has data | The left column ends at y≈670 while the right runs to y≈887, leaving a ~220 px dead block under "Pesanan terbaru". The tile "Pesanan aktif 1" carries the sub-link "3 pesanan tersimpan", so the label and the number under it disagree. Make the link say what the figure counts, or move the 3 out of that tile.

**Beranda, phone** (`848ce2…-01/-02`) | authored | status card with a full-width primary, 2×2 tiles with the odd tile spanning the row, "Beli lagi" as divided rows | Nothing blocking. The thumbnail on the first "Pesanan terbaru" row is hidden behind the bottom bar in this crop, which is a capture artefact. The page is clean.

**Beranda, empty** (`1fde1a…1440_kosong_`, `08050c…390_kosong_`) | authored | one left-aligned block, numbered steps | "Simpan pesanan pertama" and "Simpan pesanan lain" explain the same save-link flow twice, one directly below the other. Delete the second card when there are zero orders.

**Pesanan list** (`eb6945…1440_orders`, `4f649a…390_orders`) | authored | matches the reference toolbar plus segmented tabs plus card rows. Photo thumbnails, a package icon when there is no photo, divided footer row with the next-step link | The reference carries "Retur" as its own tab. The app folds it into "Dibatalkan/Retur", which is fine. On phone the tab strip clips "Dibat…" behind a fade, which is intended but gives no hint it scrolls. The long product title on the first order truncates mid-word with an ellipsis on phone. That is acceptable.

**Order detail** (`da39a7…1440_orders_PHI-…`, `0f7cba…390_orders_PHI-…-01..03`) | authored | status H1, then summary card with total, primary and secondary action, then sections. This follows the accepted contract and the reference detail | Three problems:
- The total Rp 220.816 appears three times: summary, "Total dibayar" in Pembayaran, and "Rincian total".
- Under Pengiriman, "Pesanan ini sudah selesai." repeats the H1. "Lacak perjalanan paket… di situs SPX" is plain text with no link to act on.
- On phone there is a ~55 px gap above and below the chip row (`0f7cba…-01`, y≈560–690) that reads as a hole. The "Bukti pe…" chip is cut off.

Fix: drop the "Total dibayar" row, drop the redundant sentence, and tighten the chip row spacing.

**Receipt** (`a9377a…_receipt`) | authored | a quiet document card, centred, one typeface | The order number sits in the header and again as the first row, which is redundant but defensible on a printable record. No issue.

**Toko list and profile** (`4439b4…390_stores`, `74a786…1440_stores_batiknusantara`, dark `009d98…`) | authored | letter tile "BN", history as divided date groups, a small facts card | "Putuskan Batik Nusantara" floats alone in the empty space below the card at x≈989, indented to neither the card edge nor its text. It is correct to keep it quiet, but it looks orphaned. Align it to the card's left edge or put it inside the card as its last row. The order group titles are bold dates, which makes them compete with the store H1.

**Alamat list and form** (`781186…`, `b79f00…`, `88c8b3…`, `780ed9…`) | authored | divided rows, "Utama" pill, Hapus as an underlined red text link, form capped at ~640 px | Hapus is clearly separated from Ubah. The form leaves the right half of the desktop canvas empty. That is acceptable for a short form. The phone form is clean and keeps labels visible.

**Akun** (`02888e…1440_account`, `33e22d…390_account-01..03`, dark `c89fac…`, `d141e2…`) | authored | two-column section cards, the Terang/Gelap/Sistem segmented control, a clear "Tutup akun" with what is deleted and what stays | The left column ends at ~y=695 against ~1040 on the right, a ~350 px void. Move "Tampilan" under "Keamanan" to balance the columns. "Tutup akun saya" is an underlined red link rather than a button. The consequence text is legible, and a destructive action stays quiet. Good.

**Affiliate Ringkasan** (`6041f8…1440_affiliate`, `0ca93f…390_affiliate`, dark `ea7e67…`) | authored | "Siap dibayar" is a hero tile at 1.5fr, with two smaller tiles | This reads as hierarchy, not a row of equals. The share box is `host · ref CODE` in mono with Salin link, and the mono is a data identifier, so it is justified. About 140 px of empty space follows "+ Gabung program toko lain". Fine.

**Komisi** (`9f61bd…1440_affiliate_komisi`, `1fb36c…390_…`, dark `c4f366…`) | authored | table on desktop, stacked cards on phone, state pills with dates | Chip rows share one line on desktop. On phone there are two scrolling rows, where the second clips "Siap dibayar → Sud…" with no visible affordance. Rows show `DEMO-AFF-1` identifiers, which is seed data and not a design issue.

**Program, Detail, Gabung, Undangan** (`938e82…`, `9ea7a7…-01..03`, `3fb075…`, `ccdb84…`, `89c8eb…`, `794047…`) | authored | per-programme figures in a six-column strip, a code-and-link card, an uncluttered join form | On the phone detail (`9ea7a7…-01`) the share link truncates to "RINA…" in the first view, hiding the part that identifies the code. The Riwayat komisi, "Rekening pembayaran" and "Pertanyaan pembayaran" cards are all one weight, so the masked bank details carry no more emphasis than the help card. Give the payment account card the same weight as the hero tile, or put it before Riwayat.

**Claim refusal and 404** (`324bd5…1440_klaim…`, `8bd3a4…390_…`, `2da1b8…390_tidak-ada`) | authored | an honest refusal card with a way forward | At 1440 the claim card is centred in a ~560 px column, while the equivalent dead-end card on Undangan is left-aligned. Pick one placement for dead-end cards.

**Sign-in and signed-out claim** (`67135f…1440_keluar_masuk`, `d96473…`, `b1a58d…390_…`, `a1d421…`) | authored | brand, one promise, three check-bulleted benefits, and a form card | The checkmark bullets and a single card beside a headline are close to a template pattern, but there are only three items and the content is specific (orders across stores, addresses, affiliate commission). I'd keep it. The "Masuk lokal / pengembangan" pill and field are dev-only, as the doc states. The production Google button was not rendered and cannot be judged here.

**Dark theme** (all `*d_*`) | authored | contrast holds on badges, tiles and the indigo primary. The active segmented switch has a visible outline | Nothing blocking.

## Template signals

I checked the list against what I saw:
- No dark hero, no gradient or accent word in a headline, no tracked-uppercase eyebrows. The reference's "MENU UTAMA" label and uppercase store names in "Beli lagi" were deliberately dropped.
- No icon tiles, no `A // B` labels, no `→` on actions. Arrows were removed (the reference still has them), and "Lihat tautan" rows end in a chevron.
- Rows of equal cards appear in two places: three tiles on Beranda and Ringkasan. Each tile has distinct data, and Ringkasan has a hero tile. That is acceptable.
- No unsourced claims such as "resmi", "terpercaya" or "bersertifikat". "Data setiap toko tetap terpisah" is a statement about the product itself.
- Photos: real product images where they exist, a neutral package icon where they don't, letter tiles for stores. No drawings or generated images are used as stand-ins. The layout would not fit an unrelated business, because the orders, commissions and WhatsApp hand-off are specific.

## Reference fidelity

- **Followed:** shell geometry, status-first detail, order-card anatomy, phone bottom bar, token feel. Compare `670261…390_orders` and `96eb1b…1440_orders` against `4f649a…390_orders` and `eb6945…1440_orders`. The app is more compact and uses a different order of actions, but with the same grammar.
- **Dropped where the app has no data:** vouchers, "Perlu Tindakan" cards, notification bell, Notifikasi and Data akun cards, price on "Beli lagi", the "Mode Uji Coba Lokal" banner. This is documented in the design record and matches contract C5. The result is thinner than the reference, and the left-column voids on Beranda and Akun are the visible cost.
- **Deliberate difference:** the app is full-bleed (sidebar at the left edge). The reference centres a 1200 px box with gutters. The owner directed this.

## Research and transfer rationale

- The reference is the owner-accepted prototype, and the reasoning for adopting its anatomy is written down. I accept that for the buyer screens.
- No reference image was inspected for the affiliate screens (Ringkasan, Komisi, Program, Detail, Gabung). The contract says "same UI/UX, different content", but the ledger table, share-link box and payout-account card have no inspected source. They look consistent with the shell, but this is a missing-evidence item.
- The record explicitly declines external order-tracking research (Shopee/Tokopedia). That is the owner's call, but it leaves the "next step" patterns resting on one prototype.

Most important change: Show the Belanja/Affiliate switch only on Beranda/Ringkasan and Akun, which recovers about 65 px of first-screen space on every other phone page; then fix the 220 px and 350 px column voids on Beranda and Akun.

Verdict: REVISE. The pages are authored and the renders are close to the contract. The remaining items are small visible defects: duplicated totals, orphaned and unlinked text, uneven columns and the phone gaps. There is also no inspected reference for the affiliate surface.