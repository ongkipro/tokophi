Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: design/renders/1440_.png, design/renders/1440_account.png, design/renders/1440_addresses.png, design/renders/1440_addresses_edit.png, design/renders/1440_affiliate.png, design/renders/1440_affiliate_gabung.png, design/renders/1440_affiliate_komisi.png, design/renders/1440_affiliate_program.png, design/renders/1440_affiliate_undangan.png, design/renders/1440_keluar_klaim_t_tidak-sah.png, design/renders/1440_keluar_masuk.png, design/renders/1440_kosong_.png, design/renders/1440_orders.png, design/renders/1440_orders_PHI-713020233OA7.png, design/renders/1440_orders_PHI-713020233OA7_receipt.png, design/renders/1440_stores_batiknusantara.png, design/renders/1440d_.png, design/renders/1440d_account.png, design/renders/1440d_affiliate.png, design/renders/1440d_affiliate_program.png, design/renders/1440d_orders_PHI-713020233OA7.png, design/renders/1440d_stores_batiknusantara.png, design/renders/390_.png, design/renders/390_account.png, design/renders/390_addresses.png, design/renders/390_addresses_edit.png, design/renders/390_affiliate.png, design/renders/390_affiliate_e5d9b39c-8605-4581-89a2-477089f18bef.png, design/renders/390_affiliate_gabung.png, design/renders/390_affiliate_komisi.png, design/renders/390_affiliate_undangan.png, design/renders/390_keluar_klaim_t_tidak-sah.png, design/renders/390_keluar_masuk.png, design/renders/390_kosong_.png, design/renders/390_kosong_addresses.png, design/renders/390_kosong_affiliate.png, design/renders/390_kosong_orders.png, design/renders/390_kosong_stores.png, design/renders/390_orders.png, design/renders/390_orders_PHI-713020233OA7.png, design/renders/390_stores.png, design/renders/390_tidak-ada.png, design/renders/390d_account.png, design/renders/390d_affiliate_komisi.png, design/renders/390d_orders_PHI-713020233OA7.png
References: design/refs/prototype/1440_account.png, design/refs/prototype/1440_dashboard.png, design/refs/prototype/1440_orders.png, design/refs/prototype/390_dashboard.png, design/refs/prototype/390_orders.png, design/refs/prototype/390_orders_PHI-202865413Q8M.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: ffa197fdd16ed51c
Images-SHA: c19f4d6acafec82f
Output-SHA: f43f20f69081fe68

All 71 images opened and inspected. The last six (`75deec…`, `74a5e1…`, `96eb1b…`, `dd0040…`, `670261…`, `57b2dc…`) are the prototype references, not the build. I made no edits, so this is a read-only review.

## Section review

shell, desktop (256 px sidebar, 64 px topbar, identity card, Belanja/Affiliate switch) | authored | matches `1440_dashboard` geometry; drops the reference's "MENU UTAMA" eyebrow, banner and nav count badge, as C3 requires | the switch is a segmented control stacked on an identity card on a nav list, so three bordered grey blocks sit before the first nav item. Merge the identity card and switch into one block.

shell, phone (topbar, 60 px switch, bottom bar) | authored | matches `390_dashboard` bar and underline | the Belanja/Affiliate switch costs ~60 px on every page, and the Affiliate "Gabung" slot sits in the 5-slot bar. Both are recorded as open; keep the switch on Beranda and Akun only.

Beranda (`1440_-01`, `390_-01/02`) | authored | partial match; the reference's two action cards plus four tiles become one status strip plus three tiles | "Pintasan" is three links that duplicate sidebar Alamat/Akun, so the right column is filler beside two near-identical blouse rows on the left. Replace it with the one next step that has data, or delete it.

Beranda, empty (`1440_kosong_`, `390_kosong_-01`) | authored | none needed | a ~40 px dead gap sits between "…menyimpannya ke akun:" and the numbered list. The 3-step list is the hierarchy here, so remove the empty paragraph.

Pesanan list (`1440_orders`, `390_orders`) | authored | matches `390_orders` ref anatomy (toolbar, segmented tabs, cards) | the seed shows one store and three similar blouse thumbnails, so the list reads monotonous. The reference's three stores and statuses carried scanning. Seed a second store for the render.

Order detail, desktop (`1440_orders_PHI…-01`) | authored | C4 satisfied: total and actions top-right, sections left | left cards (Pembayaran, Pengiriman, Dikirim ke) have ~45 px extra bottom padding versus ~24 px top, so they look under-filled. Fix the card padding.

Order detail, phone (`390_orders_PHI…-01/02/03`) | authored | matches `390_orders_PHI-2028…` status-first anatomy | the "Salin" button wraps under the resi as a 44 px block and breaks the key-value rhythm, and the chip row has ~50 px of air on both sides. Keep Salin inline as an icon button and tighten the chip row.

Bukti pesanan (`…_receipt-01`) | authored | none needed; plain printable record | the order number appears three times (subhead, card header, first row). Drop the subhead.

Toko profile (`1440_stores_batiknusantara`, `390_stores`) | authored | none | "Putuskan Batik Nusantara" floats alone below the card, in underlined red. Make it a row inside "Riwayat dengan toko ini".

Alamat list and form (`1440_addresses`, `390_addresses`, `…_edit`) | authored | none | the 680 px form sits left of a 1072 px column, which is fine. "Hapus" is red without underline here but underlined in "Putuskan" and "Tutup akun saya". Pick one destructive-link treatment.

Akun (`1440_account`, `390_account`) | authored | none | the left column ends ~380 px above the right, and "Tutup akun" is a 7-line paragraph in full body ink, heavier than any neighbouring card. Set it in muted text and split "goes" from "stays" into two short lines.

Affiliate Ringkasan (`1440_affiliate`, `390_affiliate`) | authored | none; the hero "Siap dibayar" tile makes the one money figure win | the grey share-link bar looks like an input but is not editable. Style it as read-only text beside the copy button, and don't truncate `ref` on phone (see Program detail).

Komisi (`1440_affiliate_komisi`, `390_…`) | authored | none | the table works at 1440 and cards at 390; monospace order numbers are real identifiers. Two chip rows on phone scroll sideways with the last chip clipped. A sticky filter summary would show what is active.

Program and Program detail (`1440_affiliate_program`, `390_affiliate_e5d9…`) | authored | none | the share link truncates to `ref RINA…`, cutting off the part that identifies the affiliate. The code is on the line above, but the link is what gets shared, so show the full link on two lines.

Gabung and Undangan (`1440_affiliate_gabung`, `…_undangan`) | authored | none | the round-9 note says the dead-end card was made left-aligned, but `1440_affiliate_undangan-01` still centres its heading, text and both buttons in the card, while the page heading is left-aligned. Left-align the card, as Beranda empty already does.

Sign-in (`1440_keluar_masuk`, `390_keluar_masuk`, `…klaim…`) | authored but generic in part | three checkmark bullets plus a card is the common sign-in split; acceptable since the three lines are real benefits | at 390 a white strip is still visible under the card in both renders, though round 9 says the root carries the canvas colour. The orange "pengembangan" pill and missing Google button mean this is not what production shows. The refusal state the "klaim" file names is never rendered; it shows sign-in. Fix the strip, and render the refusal after sign-in.

Empty states (`390_kosong_*`) | authored | none | Pesanan, Toko and Alamat cards centre their text. The Beranda empty and affiliate empty are left-aligned, so the pattern differs by page. The Pesanan card also has ~40 px extra bottom padding.

404 (`390_tidak-ada`) | authored | none | it works. Its heading is larger than other page H1s, which breaks C3. Set it at 24 px.

Dark theme (`1440d_*`, `390d_*`) | authored | none | the active Belanja segment is `#000` on a `#1b1b1b` track, with a barely visible edge. The round-4 contrast pass did not re-measure this control. Raise the active fill or add a 1 px border.

## Evidence and reference comparison

- **Hierarchy:** `1440_-01.png` leads with the in-transit strip (indigo button) and `Rp 129.200` in accent, so money outranks counts, as the transfer rationale intends. In the reference, four equal tiles and two action cards flatten that order. The mismatch is deliberate and explained.
- **Rhythm and density:** order detail (`1440_orders_PHI…-01`) is the strongest screen. It has a 1.5fr/1fr grid, a 32 px total, and one primary beside one secondary action. The reference's 6-order list at `96eb1b…` has more variety; ours reads sparse because the seed has one store.
- **Imagery:** real product photos with the package-icon fallback (`1440_orders-01`, first row) honour "no fabricated photos". Reference images of coffee beans and keyboards come from multiple stores; ours repeats one blouse.
- **Reference fidelity:** the dropped elements are `MENU UTAMA`, the beta banner, `→` arrows, the notification bell and the nav count badge. Each is excluded by C3 or by the "no data" rule. The "Do not substitute" list is respected: no eyebrows, no emoji, no illustrations.
- **Research:** the only reference is the owner-accepted local prototype. That is a legitimate decision and is recorded, and the market-review note says external study was not adopted. There is no reference for the affiliate ledger or the sign-in, and the transfer rationale covers shell anatomy only. Not blocking, but those two surfaces rest on the builder's judgement.
- **Broken rendering:** none at 1440 or 390. The fixed bottom bar overlapping content in full-page phone slices (`390_account-01`) is a capture artefact and is recorded. The near-empty slices (`390_account-03`, `390_addresses-02`, `390_kosong_-02`) are scroll leftovers.
- **Claims:** no "resmi", "terpercaya" or "bersertifikat" language. The store-supplied "7 hari kerja" and "3 hari kerja" are labelled as the store's own figures.

Most important change: left-align the dead-end card on `affiliate/undangan` and make the empty-state pattern (alignment, padding, no stray gap) consistent across Beranda, Pesanan, Toko, Alamat and the sign-in white strip, because the notes already claim these are fixed and the renders show otherwise.

Verdict: REVISE