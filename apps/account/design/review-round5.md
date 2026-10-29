Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: design/renders/1440_.png, design/renders/1440_account.png, design/renders/1440_affiliate.png, design/renders/1440_affiliate_komisi.png, design/renders/1440_affiliate_program.png, design/renders/1440_orders.png, design/renders/1440_orders_PHI-641355083NMN.png, design/renders/1440d_.png, design/renders/1440d_orders_PHI-641355083NMN.png, design/renders/1440d_stores_batiknusantara.png, design/renders/390_.png, design/renders/390_addresses.png, design/renders/390_affiliate.png, design/renders/390_affiliate_gabung.png, design/renders/390_affiliate_komisi.png, design/renders/390_orders.png, design/renders/390_orders_PHI-641355083NMN.png, design/renders/390_tidak-ada.png, design/renders/390d_account.png, design/renders/390d_affiliate_komisi.png
References: design/refs/prototype/1440_account.png, design/refs/prototype/1440_dashboard.png, design/refs/prototype/1440_orders.png, design/refs/prototype/390_dashboard.png, design/refs/prototype/390_orders.png, design/refs/prototype/390_orders_PHI-202865413Q8M.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 7f24ce1e18b0810f
Images-SHA: d487b80deb2bc173
Output-SHA: 7cbb258101e88a40

All 42 images opened and inspected. The last six (`75deec…` to `57b2dc…`, the Sari Andini renders with the "Mode Uji Coba Lokal" banner) are the prototype references, not the built app. I used them as the reference for judging fidelity.

## Sections, top to bottom

**Shell: sidebar, topbar, workspace switch, bottom bar (all renders)** | authored (inherited from the accepted prototype) | matches `prototype/1440_dashboard` and `390_dashboard`: 256 px sidebar, identity card, indigo-tint active item, 5-item bottom bar | At 1440 the sidebar below the nav (about 500 px) is empty, and the brand lockup "TokoΦ / Akun pembeli" is about 14 px, too small to anchor the corner. Enlarge the wordmark one step.

**Beranda 1440 / 390 / dark (`1440_-01`, `1440d_-01`, `390_-01/02`)** | generic-but-justified | matches the prototype geometry, minus the action cards and voucher column, which have no data | Four identical stat tiles lead the page, so nothing says "do this next". A live order ("Sedang diproses") has the same weight as "Alamat tersimpan 2". The left column ends at y≈645 and the right at y≈757, leaving a visible void. Pull the one active order into a status strip above the tiles, or drop the "Alamat tersimpan" tile.

**Pesanan list (`1440_orders`, `390_orders-01/02`)** | authored | matches the prototype list: thumbnail, store, badge, date, total, next-step link | The native `<select>` shows the browser chevron and a different height and border from the text input beside it. On the phone the select text is bold and oversized, so the toolbar looks mismatched. Restyle the select to the same 44 px control. The right-hand "Lihat perkembangan" is muted grey text with no link affordance.

**Detail pesanan (`1440_orders_PHI…-01/02`, `1440d…`, `390…-01…04`)** | authored | the status-first H1 matches `390_orders_PHI-202865413Q8M` | **This contradicts contract C4.** The summary card (total plus two buttons) spans the full 1070 px at 1440 with about 600 px of empty space to the right of the buttons. C4 puts summary and actions in the right column. The right column then ends at y≈905 while the left runs past 1580. Move the summary and actions into the top of the right column, or make the summary a two-column card with the total on the left and the actions on the right. The timeline, key-value rows and totals are clear and add up (903.000 − 68.000 + 68.000 + 30.070 = 933.070). The mix of package-icon and real photo thumbnails is honest. On the phone, product titles cut to "Blouse Katun Premium Wanita…" while desktop shows the full title, so the buyer can't see which item it is. Allow three lines on the phone.

**Toko profile, dark (`1440d_stores_batiknusantara-01`)** | authored | no prototype reference for this page | The "BN" monogram, order history, privacy note and destructive card have clear hierarchy. The red-outlined "Putuskan Batik Nusantara" inside a full card is heavier than the rest of the page. Reduce it to a text-link button, like "Hapus" on Alamat.

**Akun (`1440_account`, `390d_account-01/02`)** | authored | matches the prototype's two-column grid with the merged "Terhubung" card | Left and right columns end unevenly (693 vs 726), which is fine. "Keluar dari akun" is red text with 4.5:1 contrast, which is correct. No finding.

**Alamat (`390_addresses-01/02`)** | authored | the prototype has no render of this page | Cards are divided and "Hapus" is separated as a destructive link. Slice `-02` is only a 22 px sliver showing the bottom bar's indigo underline mid-page. That is the known full-page-capture artefact, not a product defect. The page itself is fine.

**Affiliate Ringkasan (`1440_affiliate-01`, `390_affiliate-01/02`)** | authored | same shell as the buyer side, as the owner asked | The three tile captions ("Tunggu transfer dari toko", "Termasuk belum selesai", "Dicatat oleh toko") are indigo like the links on Beranda but are static notes, so they read as dead links. Make them muted. Below the programme cards the lower 25 % of the desktop page is empty. `Rp 58.400 = 40.400 + 18.000` reconciles.

**Affiliate Komisi (`1440_affiliate_komisi`, `390_affiliate_komisi`, `390d_…`)** | authored | no external reference (ledger table inherited from the buyer list anatomy) | The desktop table is the strongest screen: right-aligned money, tabular figures, tinted state badges with dates, monospace order numbers that are real identifiers. On the phone the two filter groups wrap onto two rows each (about 150 px), pushing the ledger down. Orders uses a scrolling chip row instead, so the two lists are inconsistent. Use the same single scrolling row. The ledger reconciles (ditahan 45.800 + 18.400 = 64.200).

**Affiliate Program (`1440_affiliate_program`)** | authored | none | Six metrics in a row per programme are readable. The cards repeat Ringkasan's programme list, and the lower 55 % of the page is empty. Fine for now, but it needs a reason to exist beyond Ringkasan, such as the detail link.

**Gabung (`390_affiliate_gabung-01`)** | authored | none | **Clipped rendering:** the input placeholder is cut to "batiknusantara atau batiknusanta". Shorten the placeholder to "namatoko" and keep the example in the helper text above. Otherwise the layout is clear and uses the labelled-field rule.

**404 (`390_tidak-ada-01`)** | authored | none | It stays inside the shell with a single action. Its centred heading is the only centred text in a left-aligned app, which is acceptable for an error state.

## Template-signal check

None of the listed signals appear. There is no navy hero or grid texture, no gradient headline word, no eyebrow (the prototype's "MENU UTAMA" and demo banner were deliberately dropped), and no icon-tile feature cards or `→` on buttons. Stat tiles repeat, but they are comparable numbers, which the contract allows. Monospace appears only on order numbers, codes and AWBs, which are data identifiers. There are no unsupported "resmi/terpercaya" claims. The look is a restrained SaaS portal, generic by category and justified by the owner-accepted Seller-aligned prototype.

## Reference and transfer

Compared with `prototype/1440_dashboard`, `390_orders_PHI-202865413Q8M` and `390_dashboard`:
- **Matched:** shell geometry, indigo-tint active nav, status-first detail, capsule badges, 2×2 phone tiles, bottom bar. Dark mode is coherent.
- **Intentionally dropped:** the action cards (pay/track), vouchers, the notifications bell, the "→" glyphs and the banner. The record explains this as "no data".
- **Cost of dropping them:** the app's Beranda no longer shows a next-step strip. The prototype's orange and blue cards were its only strong hierarchy device, and nothing replaces them when an active order exists.
- **Affiliate:** no inspected reference exists for the affiliate surface. Its only rationale is the owner's "same UI" direction. That is acceptable, but a ledger or payout precedent was never inspected.
- **Detail desktop layout:** the prototype and contract C4 put the summary in a right column, and the render does not.

Most important change: Put the order-detail summary and actions in the desktop right column (or a compact two-column summary), per C4, so the page is no longer a full-width card with a large empty area.

Verdict: REVISE