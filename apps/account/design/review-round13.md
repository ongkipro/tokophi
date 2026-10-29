Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: design/renders/1440_.png, design/renders/1440_account.png, design/renders/1440_addresses.png, design/renders/1440_addresses_edit.png, design/renders/1440_affiliate.png, design/renders/1440_affiliate_gabung.png, design/renders/1440_affiliate_komisi.png, design/renders/1440_affiliate_program.png, design/renders/1440_affiliate_undangan.png, design/renders/1440_keluar_klaim_t_tidak-sah.png, design/renders/1440_keluar_masuk.png, design/renders/1440_klaim_t_tidak-sah.png, design/renders/1440_kosong_.png, design/renders/1440_orders.png, design/renders/1440_orders_PHI-713020233OA7.png, design/renders/1440_orders_PHI-713020233OA7_receipt.png, design/renders/1440_stores_batiknusantara.png, design/renders/1440d_.png, design/renders/1440d_account.png, design/renders/1440d_affiliate.png, design/renders/1440d_affiliate_program.png, design/renders/1440d_orders_PHI-713020233OA7.png, design/renders/1440d_stores_batiknusantara.png, design/renders/390_.png, design/renders/390_account.png, design/renders/390_addresses.png, design/renders/390_addresses_edit.png, design/renders/390_affiliate.png, design/renders/390_affiliate_e5d9b39c-8605-4581-89a2-477089f18bef.png, design/renders/390_affiliate_gabung.png, design/renders/390_affiliate_komisi.png, design/renders/390_affiliate_undangan.png, design/renders/390_keluar_klaim_t_tidak-sah.png, design/renders/390_keluar_masuk.png, design/renders/390_klaim_t_tidak-sah.png, design/renders/390_kosong_.png, design/renders/390_kosong_addresses.png, design/renders/390_kosong_affiliate.png, design/renders/390_kosong_orders.png, design/renders/390_kosong_stores.png, design/renders/390_orders.png, design/renders/390_orders_PHI-713020233OA7.png, design/renders/390_stores.png, design/renders/390_tidak-ada.png, design/renders/390d_account.png, design/renders/390d_affiliate_komisi.png, design/renders/390d_orders_PHI-713020233OA7.png
References: design/refs/prototype/1440_account.png, design/refs/prototype/1440_dashboard.png, design/refs/prototype/1440_orders.png, design/refs/prototype/390_dashboard.png, design/refs/prototype/390_orders.png, design/refs/prototype/390_orders_PHI-202865413Q8M.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 0c31edc337f624ea
Images-SHA: df8b80fed942b2e2
Output-SHA: b2d431a8a662aff1

# Visual review: Akun TokoΦ (`apps/account`)

I opened all 73 listed images. The review has two weak points:
- **Coverage:** no build render shows an unpaid, shipped, return-in-progress or cancelled order.
- **Reference research:** the reference is one internal prototype, with no external market evidence.

## Section by section

Format: section | generic or authored | look matched | one fix

**Beranda (1440 / 390 / dark)**
- Status strip | authored | prototype dashboard, minus its banner and arrows (`1440_-01`, `390_-01`) | The strip repeats its state twice ("Sedang diproses" pill, then "sedang diproses" in the heading). Drop the pill.
- Stat tiles (3, one accent figure) | authored, data-driven | matches the prototype, with one money figure outranking the counts | "Toko terhubung 1 · Lihat toko" is a count with a link to a one-row page. Fold it into another tile.
- Pesanan terbaru plus right column | authored | prototype two-column split | The left column ends at y≈667 and the right at y≈887, so a ~220 px void sits under the order list. Move "Beli lagi" under it, or cap the right column.
- "Simpan pesanan lain" | generic | none | The card is a paragraph with no control. Add the action ("Buka tautan simpan") or cut it to one line.

**Pesanan list (`1440_orders`, `390_orders`)**
- Toolbar and status tabs | authored | matches the prototype | At 390 the tabs fade out at "Dibat…", so "Dibatalkan/Retur" is reachable only by swiping. Use two short rows, or shorten the labels.
- Order cards | authored | matches the prototype | At 1440 the first card's product title runs ~700 px on one line, while at 390 it clamps to two. Clamp it at desktop too.

**Detail pesanan, delivered (`1440_orders_PHI…`, `390_…` ×3, `390d_…`)**
- H1 status, summary card, sticky right column | authored | meets C4 (status-first, summary right) | Fine. "Bukti pesanan" and "Ajukan retur / komplain" sit side by side at equal weight. Give returns its own row, since it is a different task.
- Produk, Pembayaran, Pengiriman, Dikirim ke | authored | divided key-value rows, no card-in-card | On the phone the resi "Salin" button is a 44 px block that leaves dead space beside the number. Put it inline.
- Help card with the store's own return and complaint figures | authored | none needed | Fine. The figures are the store's, with no legal citation and no unsourced claim.

**Bukti pesanan (`…_receipt-01`)** | authored | document-like, centred | The order number appears in the header and again as the first row. Remove the row.

**Toko list and profile (`390_stores`, `1440_stores_batiknusantara`, dark)** | authored | matches the prototype | The "Putuskan Batik Nusantara" row floats below the card and is detached from its parent. Move it into the card footer.

**Alamat list and form (`1440_addresses`, `…_edit`, `390_addresses`, `390_addresses_edit`)**
- List | authored | clear | The red underlined "Hapus" is fine. Nothing is wrong here.
- Form | generic form | none needed | Only Kode pos carries "(wajib)". Nama and Nomor HP are required but unmarked, so required and optional read inconsistently. Mark all three the same way. Also, the "Cari" button and "Ketik minimal 3 huruf" duplicate each other.

**Akun (`1440_account`, `390_account` ×3, dark)**
- Section cards | authored | matches the prototype profile grid | Fine.
- "Keluar dari akun" | authored | none | Logging out is non-destructive but is styled the same red as "Tutup akun saya". Make it neutral so only account closure reads as destructive. The red links also disagree on underline: "Keluar" has none, "Hapus", "Putuskan" and "Tutup" have one.

**Affiliate Ringkasan, Komisi, Program (1440 / 390 / dark)**
- Hero tile "Siap dibayar" plus two tiles | authored | desktop hero is visible; the phone stacks hero then two | Fine.
- Program cards (BN/PM initials, mono ref link) | authored | neutral initials, no invented logos | Fine.
- Komisi table and cards | authored | ledger-like, with state badges carrying text | On the phone both chip rows clip ("Permata Mall Store", "Sudah dibayar" and "Batal" are off-screen). Move one dimension into a sheet.
- Program detail (`390_affiliate_e5d9…`) | authored | none | The "Rekening pembayaran" key-value block is a grey panel inside a card, which breaks C6 (no card-in-card). Make it plain divided rows.

**Gabung and Undangan (1440 / 390)** | authored | left-aligned dead-end and form cards, as the contract says | Fine. Each card is 680 px wide with the right side empty, which is acceptable.

**Sign-in and claim refusal (`1440_keluar_masuk`, `390_keluar_masuk`, `…klaim…`)**
- Sign-in | mostly authored | the left column has a three-checkmark list, but only once | The "pengembangan" pill is a dev artefact. No Google button is rendered, so the production sign-in is unverified.
- Claim refusal (`324bd557…`, `8bd3a48f…`) | authored | none | The grey "Kalau ini pesanan Anda" box sits inside the card, which is card-in-card again. Replace it with a plain paragraph.

**Empty states (`1440_kosong_`, `390_kosong_*`)** | authored | left-aligned, as the contract says | Fine. The sidebar's "Promosikan toko favorit / Jadi affiliate" footer is promotion, not task, so cut it or shrink it.

**404 (`390_tidak-ada`)** | authored | fine | Nothing to change.

## Template-signal check
- **Template signals:** none found. There is no dark hero, no gradient headline word, no eyebrow pills, no tinted icon-tile card rows and no `A // B` labels.
- **Decoration:** none. The only imagery is real product photos, plus a neutral package icon where a photo is missing.
- **Brand fit:** the Φ wordmark and indigo are consistent across all 73 renders.
- **Identifier typeface:** order numbers are monospace in Komisi (`DEMO-AFF-1`, `PHI-4980`) but sans elsewhere. Pick one.
- **Capture gaps:** each phone slice seam hides about 64 px behind the fixed bottom bar. The step between `390_account-01` and `-02` does not show "Keluar dari akun". `88c8b30a…-02` is a blank sliver, so the bottom of the phone address list is not evidenced.

## Reference comparison
The last six images are the prototype references, not the build: `75deec…`, `74a5e1…`, `96eb1b…`, `dd0040…`, `670261…`, `57b2dc…`. They show the demo banner, a notification bell, "MENU UTAMA", `→` glyphs, voucher and "Beli Lagi" price cards, a four-tile row and an orange "Perlu Tindakan" card for an unpaid order.

**What carried over:**
- The shell geometry matches: 256 px sidebar, 64 px topbar, identity card and indigo-tinted active nav item.
- The build is full-bleed rather than the prototype's 1200 px centred box. That is an owner-approved amendment recorded in C1.

**Where it differs:**
- The build removes banner, bell, vouchers, arrows and the uppercase menu label. Those match the "elements without data" rule and the no-eyebrow rule.
- It drops the prototype's price cards in "Beli lagi", which is consistent with the rule against promising prices.

**What is missing:**
- Prototype `57b2dc…` shows an unpaid order with "Lanjutkan pembayaran" and `74a5e1…` shows a shipped order with "Lacak Pengiriman". The build has no render of any pay, track, return-in-progress or cancelled state.
- Those states are the buyer's main job ("what happens next"), and they are evidenced only on the prototype.
- The direction record cites only the internal prototype. It notes that Shopee and Tokopedia research was "not adopted", and the spec §19 market review is named but none of its observations or images are recorded. So the transfer rationale is "the owner chose it", not a documented design decision.

Most important change: render and review the pay, tracking, return-in-progress and cancelled order states (Beranda action card and order detail) in the build, with a recorded external reference, because the core "what next" task has no build evidence.

Verdict: REVISE