Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: design/renders/1440_.png, design/renders/1440_account.png, design/renders/1440_addresses.png, design/renders/1440_addresses_edit.png, design/renders/1440_affiliate.png, design/renders/1440_affiliate_gabung.png, design/renders/1440_affiliate_komisi.png, design/renders/1440_affiliate_program.png, design/renders/1440_affiliate_undangan.png, design/renders/1440_keluar_klaim_t_tidak-sah.png, design/renders/1440_keluar_masuk.png, design/renders/1440_klaim_t_tidak-sah.png, design/renders/1440_kosong_.png, design/renders/1440_orders.png, design/renders/1440_orders_PHI-713020233OA7.png, design/renders/1440_orders_PHI-713020233OA7_receipt.png, design/renders/1440_status_.png, design/renders/1440_status_orders.png, design/renders/1440_status_orders_PHI-4980.png, design/renders/1440_status_orders_PHI-641355083NMN.png, design/renders/1440_status_orders_PHI-713020233OA7.png, design/renders/1440_stores_batiknusantara.png, design/renders/1440d_.png, design/renders/1440d_account.png, design/renders/1440d_affiliate.png, design/renders/1440d_affiliate_program.png, design/renders/1440d_orders_PHI-713020233OA7.png, design/renders/1440d_stores_batiknusantara.png, design/renders/390_.png, design/renders/390_account.png, design/renders/390_addresses.png, design/renders/390_addresses_edit.png, design/renders/390_affiliate.png, design/renders/390_affiliate_e5d9b39c-8605-4581-89a2-477089f18bef.png, design/renders/390_affiliate_gabung.png, design/renders/390_affiliate_komisi.png, design/renders/390_affiliate_undangan.png, design/renders/390_keluar_klaim_t_tidak-sah.png, design/renders/390_keluar_masuk.png, design/renders/390_klaim_t_tidak-sah.png, design/renders/390_kosong_.png, design/renders/390_kosong_addresses.png, design/renders/390_kosong_affiliate.png, design/renders/390_kosong_orders.png, design/renders/390_kosong_stores.png, design/renders/390_orders.png, design/renders/390_orders_PHI-713020233OA7.png, design/renders/390_status_.png, design/renders/390_status_orders_PHI-4980.png, design/renders/390_status_orders_PHI-641355083NMN.png, design/renders/390_status_orders_PHI-713020233OA7.png, design/renders/390_stores.png, design/renders/390_tidak-ada.png, design/renders/390d_account.png, design/renders/390d_affiliate_komisi.png, design/renders/390d_orders_PHI-713020233OA7.png
References: design/refs/prototype/1440_account.png, design/refs/prototype/1440_dashboard.png, design/refs/prototype/1440_orders.png, design/refs/prototype/390_dashboard.png, design/refs/prototype/390_orders.png, design/refs/prototype/390_orders_PHI-202865413Q8M.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 98529817605ad5af
Images-SHA: 69f30472d90a03fe
Output-SHA: ba991b6b5ec51295

Status: I opened all 87 images, listed in the table below, and the review follows.

All paths are under `design/review-slices/`.

## Per-section review

| Section | Generic or authored | Look matched | One concrete fix |
|---|---|---|---|
| Shell, desktop (sidebar 256, brand row, identity card, Belanja/Affiliate switch, 64 px topbar) | Authored | The prototype's geometry (`75deec…1440_account`, `74a5e1…1440_dashboard`). The indigo-tint active item and card radii carry over. The prototype's banner, "MENU UTAMA" label and bell are dropped. | Dark theme only: the active Belanja/Affiliate segment gets a white 1 px outline (`7c05aa…1440d_`, `c89fac…1440d_account`). Light has none, and the dark order-filter tabs have none. Use a fill step like the other segmented controls. |
| Shell, phone (topbar, switch, 5-slot bottom bar) | Authored | The prototype's bottom bar. The switch is an addition for affiliate accounts. | The switch sits above every H1 and pushes it to y≈160. `4f649a…390_orders-01` shows only two orders above the fold. For accounts that use Affiliate rarely, move the switch into the avatar menu or the Akun page. |
| Beranda (`a4fa2b…1440_`, `4a8377…1440_status_`, `848ce2…390_`) | Authored | Status strip, then tiles, then a two-column body, per the prototype. | The left column ends at y≈640 and the right at y≈836, leaving a 200 px void under the orders. Cap the right column, or let "Beli lagi" sit under "Pesanan terbaru". |
| Beranda, empty (`1fde1a…1440_kosong_`, `08050c…390_kosong_`) | Authored | None needed. | The sidebar footer "Promosikan toko favorit … Jadi affiliate" is 12 px text in the corner. It is the only entry point for non-affiliates, so promote it to a visible row or card. |
| Pesanan list (`eb6945…`, `5956db…`, `4f649a…`) | Authored | Matches the prototype toolbar and card anatomy. | The 1440 order line (`eb6945…1440_orders`) shows a long unclamped title. Clamp it to one line with an ellipsis, as the phone render does. |
| Order detail, delivered (`da39a7…`, `0f7cba…`) | Authored | C4 status-first holds. Produk comes first, with the summary, totals and help in a right column. | Four stacked identical cards (Pembayaran, Pengiriman, Dikirim ke) make a ~2900 px phone scroll. Merge Pembayaran and Pengiriman into one card with two key-value groups. |
| Order detail, unpaid / in transit / cancelled (`59b452…`, `a79908…`, `2c436b…`, `4729a8…`, `7173ab…`, `992817…`) | Authored | The state-specific content is right: VA in groups of four, no fake resi, no tracking text on a cancelled order. | The unpaid and cancelled pages have no stepper, which is correct. "Salin" wraps alone under the resi on a phone (`0f7cba…-02`, `992817…-02`). Put it inline at the end of the number, or make the resi row a full-width tap target. |
| Bukti pesanan (`a9377a…`) | Authored | A document, not a card stack. | The order number appears in the header and again as a row. Drop the row. |
| Toko detail (`74a786…`, `009d98…`) | Authored | Header card, order history and facts panel. | "Putuskan Batik Nusantara" floats alone in the right column at y≈696, detached from the card above, so it reads as a stray link. Put it inside the facts card footer as a divided row. |
| Toko list and empty states (`4439b4…`, `d73f0b…`) | Authored | Matches the C5 repeated-card contract. | The "Lihat toko" button is full-width and heavy for a single store. Make the whole card a link and drop the button. |
| Alamat list and form (`781186…`, `b79f00…`, `88c8b3…`, `780ed9…`) | Authored | Divided rows in one card. | On the 1440 list, "Hapus" sits ~13 px inside the right edge while the "Utama" badge is flush (`781186…`). Align both to the card's inner padding. |
| Akun (`02888e…`, `33e22d…`, `c89fac…`) | Mostly authored | Section cards, but the prototype's Notifikasi and Data akun cards are dropped because there is no data. | "Keluar dari akun" is plain bold text at the bottom of the security card, so it looks like a label, not an action. Give it a bordered neutral button. Link styles are inconsistent: indigo "Lihat perangkat", red underlined "Tutup akun saya", plain "Keluar". "Terhubung" repeats sidebar destinations (Toko, Alamat, Affiliate). Keep only the affiliate status. |
| Affiliate Ringkasan (`6041f8…`, `0ca93f…`) | Authored | Hero money tile at 1.5fr, then two smaller tiles. | The "Program saya" list repeats on the Program page almost field for field (`938e82…`). Either make Program the detail view with different content, or drop the list here and keep the share links. |
| Affiliate Komisi (`9f61bd…`, `1fb36c…`, `c4f366…`) | Authored | A ledger table on desktop and cards on phone. | The second chip row clips "Siap dibayar" and then a cut-off "S" at 390 px (`1fb36c…-01`). The fade hints at scroll but leaves a half-word. Snap the row to whole chips. |
| Affiliate Program, detail, Gabung, Undangan (`938e82…`, `9ea7a7…`, `3fb075…`, `89c8eb…`) | Authored | Same card anatomy with different content. | "Gabung" appears as a nav slot, a Program-page button, and a link under the Ringkasan list. Keep the nav slot and the Program button. |
| Sign-in and claim refusal (`d96473…`, `67135f…`, `b1a58d…`, `324bd5…`) | Authored | A split layout with a dev-only pill on desktop. | `d96473…` duplicates the H1 as "Masuk untuk menyimpan pesanan Anda ke Akun TokoΦ." in the card. Cut the card line. The check-bullet list has three real benefits, so it is acceptable. |
| Dark theme (`7c05aa…`, `d141e2…`, `3dabeb…`) | Authored | Contrast looks adequate on badges, tiles and the ghost "Lihat toko". | See the shell outline above. |

## Evidence against the reference

The reference is the owner-accepted prototype (`75deec…`, `74a5e1…`, `96eb1b…`, `dd0040…`, `670261…`, `57b2dc…`). The renders keep these transferred principles:
- **Hierarchy:** the prototype's action-first order is kept, from strip to tiles to lists, and the detail page leads with human status plus a total.
- **Rhythm:** the 24 px grid, 1 px cards with radius 10 and divided rows are the same.
- **Density:** the prototype's four tiles and voucher column are cut where no data exists. This matches spec §18.5.
- **Imagery:** real `product_media` is used. Missing photos fall back to the neutral package icon rather than invented pictures, as the brief requires (`eb6945…` row 1, `a79908…` product list).

The template signals do not apply here:
- There is no dark hero, grid texture, gradient headline word, or tracked eyebrow.
- The "Perlu tindakan" and "Sedang dikirim" pills carry state, not decoration.
- Monospace is used for resi, VA and order IDs, which are data.
- The stat tiles show real figures, not placeholders.
- The page would not fit an unrelated business.
- No claim like "resmi" or "berlisensi" appears without a source.

Mismatches and gaps:
- **No affiliate reference.** The prototype has no affiliate screens. The Ringkasan, Komisi and Program screens rest only on "same UI/UX for affiliate" (owner direction). There is no inspected reference or transfer rationale for a ledger-heavy surface.
- **No reference for the order states other than the prototype's one detail page** (unpaid, in transit, cancelled).
- **Identifier treatment is inconsistent:** order numbers are monospace in Komisi (`9f61bd…`) but sans in the orders list and detail (`eb6945…`, `da39a7…`).
- **Production Google button, refund-in-progress, and prepaid-with-deadline states are not rendered.** I can't verify them, and the notes already say so.

Most important change: put "Putuskan" inside the store card and make "Keluar dari akun" a real bordered button, so the two destructive or exit actions read as actions.

Verdict: REVISE