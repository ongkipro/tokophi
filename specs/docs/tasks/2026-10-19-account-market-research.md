# TokoΦ Account — Indonesian market research (buyer account + store affiliate)

Date: 2026-10-19. Method: web search + page fetches. **Evidence grade** is stated per finding:
A = official/primary page, B = reputable press or agency page, C = vendor/blog/secondary, N = nothing found.
Several pages are dated 2026; none of this was verified inside the marketplace apps themselves.

## 1. Buyer: order tracking and completion

| Finding | Grade | Source |
|---|---|---|
| Shopee "Perlu Dikirim" = paid (or COD) and waiting for the seller to process; a "Tertunda" order is under review for up to 24 h after payment | A | [Shopee Help — status pesanan](https://help.shopee.co.id/portal/4/article/72518-[Pelacakan-Pesanan]-Dimana-saya-melihat-status-pesanan), Seller Centre article 9795 |
| Shopee Seller Centre states that from 2026-09-17 orders are completed by the system, ~2 days after arrival, and the buyer's "Pesanan Selesai" button is removed; seller funds are released about 2 days after arrival | B (a Seller Centre page surfaced by search; the exact article was not identified, so no URL is cited; the older buyer page [help 183879](https://help.shopee.co.id/portal/4/article/183879-[Pesanan]%20Mengapa%20saya%20tidak%20dapat%20menekan%20tombol%20%E2%80%9CPesanan%20Selesai%E2%80%9D) still refers to the button — re-check before relying on it) | see note |
| Shopee return/refund request window: Mall 15 days, Star+ 7 days, other stores 2 days from receipt (or before the order completes) | A | [Shopee Help 73145](https://help.shopee.co.id/portal/4/article/73145-%5BPengembalian-Barang/Dana%5D-Apa-yang-harus-dilakukan-jika-saya-belum-menerima-produk-namun-status-pesanan-telah-diterima?previousPage=secondary+category) |
| Tokopedia: track with a "Lacak" button; the buyer confirms arrival with "Konfirmasi Pesanan Tiba" | B (page timed out on fetch; seen through search snippet only) | [Tokopedia Help](https://www.tokopedia.com/help/article/pesanan-saya-belum-sampai) |
| Shopee: a shipped order can be cancelled only with the seller's approval, once per order; unshipped orders auto-cancel when the seller misses the packing window | B | [Bisnis.com](https://finansial.bisnis.com/read/20230214/563/1627795/begini-cara-membatalkan-pesanan-di-shopee-yang-sudah-dikirim), [IDX Channel](https://www.idxchannel.com/milenomic/cara-membatalkan-pesanan-di-shopee-yang-tidak-bisa-dibatalkan-perhatikan-ketentuannya/2) |

Reading: the market convention is **status tabs by next action** (belum bayar → perlu dikirim → dikirim → selesai → batal/pengembalian), a **tracking entry point on the order**, an **explicit, short return window**, and now **system-completed orders**. Our app has the tabs, status-first detail and "Lacak dengan nomor resi"; it has no return/complaint path and no stated window.

## 2. Buyer: payments

- Xendit E-commerce Payments Momentum Report 2026 (Oct 2026, 1,000 Indonesian respondents; Xendit's own transactions): e-wallet used in ~60% of purchases, 70% of buyers use e-wallets for at least half of purchases; QRIS transactions +142% (Jan 2025–Apr 2026) vs credit card +83%; bank transfer ~52% of purchases; **COD still ~40% of purchases but 40% of respondents use it less than a year ago**; **51% abandoned a purchase because their payment method was unavailable**. Grade B/C (interested party, small sample, Xendit-only volume). Sources: [Bisnis.com](https://finansial.bisnis.com/read/20261015/55/2013055/51-konsumen-indonesia-batalkan-belanja-online-akibat-metode-pembayaran-tak-tersedia), [Fortune IDN](https://www.fortuneidn.com/finance/xendit-metode-pembayaran-tak-cocok-bikin-51-konsumen-enggan-belanja-00-4vfn9-mns83w), [Selular.ID](https://selular.id/2026/10/51-konsumen-indonesia-batal-belanja-online-gara-gara-metode-pembayaran/).
- Reading: the order screen must show **how it was paid and what is still owed** for QRIS/VA/COD alike (it does), and a COD parcel must say "bayar ke kurir" (it does). Payment *method availability* is a checkout concern, not an account concern.

## 3. Buyer: sign-in method

- **Nothing found** that measures phone/WhatsApp OTP vs Google preference for Indonesian e-commerce. Vendor pages (Qiscus, Message Central) promote WhatsApp OTP; CNBC Indonesia notes WhatsApp itself added an email fallback when OTP does not arrive. Grade C/N.
- Reading: do **not** state a preference as fact. Phone OTP stays phase 2 on its existing blocker; Google remains phase 1. Whether OTP beats Google for TokoΦ buyers is an experiment to run, not a finding to cite.

## 4. Privacy law (UU PDP) — consent

- UU 27/2022 gives data subjects the right to withdraw consent and to access, correct, stop and delete processing (summary: [pasal.id](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022); grade B, non-official summary).
- Bisnis.com (2026-08-29) reports PP 33/2026 (implementing regulation): explicit consent must be free, informed, **specific and unambiguous**; **bundling consent to data processing with consent to terms and conditions is treated as ambiguous**; information about the processing must be given **before** consent is obtained. [Bisnis.com](https://teknologi.bisnis.com/read/20260829/84/1999753/aturan-turunan-uu-pdp-persetujuan-data-konsumen-lebih-ketat). Grade B; the PP text itself was **not** read (the page was behind a 403, the figures come from the search summary). **A lawyer must confirm against the PP before launch.**
- Reading for us: the claim screen already has a separate, un-ticked checkbox, the information above it, a stated scope, and per-store withdrawal ("Putuskan"). **Gap: no account-level closure/deletion and no way to see or export what the account holds.** The spec already defines `closure_pending/closed` (§4) but phase 1 never built it.

## 5. Affiliate: how the marketplaces present it

- Shopee Affiliate: commission appears first as an **estimate**, becomes **validated** once the order is validated; cancelled/not-completed orders are not counted; the dashboard shows **clicks, purchases and total commission**; tax and service fees are deducted before payout; commission up to ~4% base (sources disagree on ranges: 1–10%, 2.5–12%) plus "Komisi XTRA". Grade C (blogs/press), no official Shopee page retrieved. [ITERA blog](https://blog.itera.ac.id/?p=4673), [Dealls](https://dealls.com/pengembangan-karir/cara-menggunakan-shopee-affiliate-bagi-pemula), [Selular.ID](https://selular.id/2026/10/shopee-affiliate-untuk-pemula-begini-cara-daftar-dan-strateginya/).
- TikTok Shop affiliate: commission can be withdrawn only after the order is fully completed with no return/exchange request, above a minimum balance, to the registered bank account; 1–10% typical. No payout day count found. Grade C. [Selular.ID](https://selular.id/2025/12/cara-tarik-komisi-tiktok-affiliate-ke-rekening-dan-e-wallet/).
- Tax: DJP says affiliate commission is taxable income; Shopee collects a **16-digit NPWP (NIK matched to NPWP)** as a payout requirement and withholds PPh 21 automatically; the rate basis was changed by PP 20/2026 and was **not verified**. Grade B for the principle ([pajak.go.id](https://www.pajak.go.id/id/artikel/affiliator-cuan-jalan-pajak-aman)), N for current rates.
- Reading: our vocabulary (Siap dibayar / Ditahan / Dibayar, H+3 return hold, only completed orders count, ledger per store) matches the market's *estimate → validated → paid* model. **Differences that matter:** (a) TokoΦ stores pay commission **directly**, so any withholding duty sits with the store, not the platform — nothing on screen may imply the platform deducts tax; (b) we have **no click data**, so a "klik" column would be invented; (c) there is no minimum payout or platform wallet.

## 6. What this research does NOT support (do not write it into the spec as fact)

- Any claim about which sign-in method Indonesians prefer.
- Any specific current Shopee/TikTok payout schedule, minimum, or tax rate.
- That Tokopedia and Shopee share one status vocabulary (each page found covers one marketplace).
- Market share numbers for COD, e-wallet or QRIS outside Xendit's own data.
